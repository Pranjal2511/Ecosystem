package com.nexashare.app

import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import javax.net.ssl.SSLServerSocket

class TlsProtocolServer(
  private val identity: DeviceIdentity,
  private val engine: AndroidEngine
) {
  @Volatile private var running = false
  private var serverSocket: SSLServerSocket? = null
  private val pool = Executors.newCachedThreadPool()
  val sockets = ConcurrentHashMap<String, WsSession>()

  fun start(port: Int): Int {
    val socket = identity.sslContext.serverSocketFactory.createServerSocket(port) as SSLServerSocket
    socket.needClientAuth = false
    serverSocket = socket
    running = true
    pool.execute {
      while (running) {
        try {
          val client = socket.accept()
          pool.execute { handle(client) }
        } catch (_: Exception) {
          if (!running) {
            return@execute
          }
        }
      }
    }
    return socket.localPort
  }

  fun stop() {
    running = false
    serverSocket?.close()
    pool.shutdownNow()
  }

  fun sendJson(sessionId: String, envelope: JSONObject) {
    sockets[sessionId]?.sendText(envelope.toString())
  }

  private fun handle(socket: Socket) {
    socket.soTimeout = 120_000
    val input = BufferedInputStream(socket.getInputStream())
    val output = socket.getOutputStream()
    val requestLine = readLine(input) ?: return socket.close()
    val parts = requestLine.split(" ")
    if (parts.size < 2) {
      socket.close()
      return
    }
    val method = parts[0]
    val path = parts[1]
    val headers = mutableMapOf<String, String>()
    while (true) {
      val line = readLine(input) ?: break
      if (line.isEmpty()) {
        break
      }
      val idx = line.indexOf(':')
      if (idx > 0) {
        headers[line.substring(0, idx).trim().lowercase()] = line.substring(idx + 1).trim()
      }
    }
    try {
      if (method == "GET" && path == "/health") {
        writeHttp(output, 200, """{"ok":true,"deviceId":"${identity.deviceId}"}""")
        return
      }
      if (headers["upgrade"]?.equals("websocket", true) == true) {
        acceptWebSocket(socket, input, output, headers)
        return
      }
      val match = Regex("^/v1/transfers/([0-9a-fA-F-]+)/files/(\\d+)$").find(path)
      if (method == "PUT" && match != null) {
        val transferId = match.groupValues[1]
        val index = match.groupValues[2].toInt()
        val length = headers["content-length"]?.toLongOrNull()
          ?: throw IllegalArgumentException("SIZE_MISMATCH")
        val token = headers["authorization"]?.removePrefix("Bearer ")?.trim()
        val result = engine.receiveFile(transferId, index, token, length, input)
        writeHttp(output, 200, result.toString())
        return
      }
      writeHttp(output, 404, """{"ok":false}""")
    } catch (error: Exception) {
      val code = if (error.message == "UNAUTHENTICATED") 401 else 400
      writeHttp(output, code, """{"ok":false,"message":${JSONObject.quote(error.message ?: "error")}}""")
    } finally {
      try {
        socket.close()
      } catch (_: Exception) {
      }
    }
  }

  private fun acceptWebSocket(socket: Socket, input: BufferedInputStream, output: OutputStream, headers: Map<String, String>) {
    val key = headers["sec-websocket-key"] ?: throw IllegalArgumentException("MESSAGE_INVALID")
    val accept = wsAccept(key)
    val response = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: $accept\r\n\r\n"
    output.write(response.toByteArray())
    output.flush()
    val sessionId = UUID.randomUUID().toString()
    val session = WsSession(sessionId, output)
    sockets[sessionId] = session
    try {
      while (true) {
        val text = readWsText(input) ?: break
        engine.onControl(sessionId, text)
      }
    } finally {
      sockets.remove(sessionId)
      socket.close()
    }
  }

  private fun wsAccept(key: String): String {
    val sha1 = MessageDigest.getInstance("SHA-1")
    val digest = sha1.digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray())
    return Base64.getEncoder().encodeToString(digest)
  }

  private fun readWsText(input: BufferedInputStream): String? {
    val b1 = input.read()
    val b2 = input.read()
    if (b1 < 0 || b2 < 0) {
      return null
    }
    val opcode = b1 and 0x0f
    val masked = (b2 and 0x80) != 0
    var len = (b2 and 0x7f).toLong()
    if (len == 126L) {
      len = ((input.read() shl 8) or input.read()).toLong()
    } else if (len == 127L) {
      val buf = ByteArray(8)
      if (input.read(buf) != 8) {
        return null
      }
      len = ByteBuffer.wrap(buf).order(ByteOrder.BIG_ENDIAN).long
    }
    if (len > 64 * 1024) {
      throw IllegalArgumentException("MESSAGE_TOO_LARGE")
    }
    val mask = ByteArray(4)
    if (masked && input.read(mask) != 4) {
      return null
    }
    val payload = ByteArray(len.toInt())
    var off = 0
    while (off < payload.size) {
      val n = input.read(payload, off, payload.size - off)
      if (n < 0) {
        return null
      }
      off += n
    }
    if (masked) {
      for (i in payload.indices) {
        payload[i] = (payload[i].toInt() xor mask[i % 4].toInt()).toByte()
      }
    }
    return if (opcode == 1) String(payload, Charsets.UTF_8) else null
  }

  private fun readLine(input: BufferedInputStream): String? {
    val out = ByteArrayOutputStream()
    while (true) {
      val b = input.read()
      if (b < 0) {
        return if (out.size() == 0) null else out.toString(Charsets.US_ASCII.name())
      }
      if (b == '\n'.code) {
        break
      }
      if (b != '\r'.code) {
        out.write(b)
      }
    }
    return out.toString(Charsets.US_ASCII.name())
  }

  private fun writeHttp(output: OutputStream, status: Int, body: String) {
    val bytes = body.toByteArray()
    val reason = if (status == 200) "OK" else "Error"
    val header = "HTTP/1.1 $status $reason\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
    output.write(header.toByteArray())
    output.write(bytes)
    output.flush()
  }
}

class WsSession(val id: String, private val output: OutputStream) {
  @Synchronized
  fun sendText(text: String) {
    val payload = text.toByteArray()
    val header = if (payload.size < 126) {
      byteArrayOf(0x81.toByte(), payload.size.toByte())
    } else {
      byteArrayOf(0x81.toByte(), 126, (payload.size shr 8).toByte(), (payload.size and 0xff).toByte())
    }
    output.write(header)
    output.write(payload)
    output.flush()
  }
}

fun streamToFile(input: BufferedInputStream, file: File, expected: Long): String {
  val digest = MessageDigest.getInstance("SHA-256")
  FileOutputStream(file).use { out ->
    val buf = ByteArray(64 * 1024)
    var remaining = expected
    while (remaining > 0) {
      val n = input.read(buf, 0, minOf(buf.size.toLong(), remaining).toInt())
      if (n < 0) {
        throw IllegalArgumentException("SIZE_MISMATCH")
      }
      digest.update(buf, 0, n)
      out.write(buf, 0, n)
      remaining -= n
    }
  }
  return digest.digest().joinToString("") { "%02x".format(it) }
}
