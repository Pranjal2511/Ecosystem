package com.nexashare.app

import android.content.Context
import android.net.Uri
import java.io.File
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import java.security.cert.X509Certificate

private data class FileInfo(val uri: Uri, val index: Int, val relativePath: String, val size: Long)

class AndroidEngine(private val context: Context) {
  private var displayName = "Android"
  private lateinit var identity: DeviceIdentity
  private val deviceId get() = identity.deviceId
  private val fingerprintSha256 get() = identity.fingerprintSha256
  private val paired = JSONArray()
  private var sessionToken = ""
  private var peerDeviceId = ""
  private var incomingApprovals = mutableMapOf<String, Boolean>()

  fun start(name: String): String {
    displayName = name
    identity = DeviceIdentityFactory.create(name)
    return JSONObject()
      .put("ok", true)
      .put("deviceId", identity.deviceId)
      .put("displayName", identity.displayName)
      .put("fingerprintSha256", identity.fingerprintSha256)
      .toString()
  }

  fun snapshot(): JSONObject =
    JSONObject()
      .put("deviceId", identity.deviceId)
      .put("displayName", identity.displayName)
      .put("fingerprintSha256", identity.fingerprintSha256)
      .put("paired", paired)

  fun createPairing(): JSONObject {
    val sessionId = UUID.randomUUID().toString()
    val code = "%06d".format(SecureRandom().nextInt(1_000_000))
    return JSONObject()
      .put("pairingSessionId", sessionId)
      .put("code", code)
      .put(
        "note",
        "Receiving on Android uses the same protocol as Windows. Full inbound TLS server requires a physical device test after JDK/Gradle are installed."
      )
  }

  fun pairGuest(body: JSONObject): String {
    val host = body.getString("host")
    val port = body.getInt("port")
    val expected = body.getString("expectedFingerprint").lowercase()
    val client = pinnedClient(expected)
    val latch = CountDownLatch(1)
    var error: String? = null
    val ws = client.newWebSocket(
      Request.Builder().url("wss://$host:$port").build(),
      object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
          val hello = envelope(
            JSONObject()
              .put("type", "pairing_hello")
              .put("pairingSessionId", body.getString("pairingSessionId"))
              .put("code", body.getString("code"))
              .put(
                "guest",
                JSONObject()
                  .put("deviceId", identity.deviceId)
                  .put("displayName", identity.displayName)
                  .put("fingerprintSha256", identity.fingerprintSha256)
                  .put("publicKeySpkiHex", identity.publicKeySpkiHex)
              )
          )
          webSocket.send(hello.toString())
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          val parsed = JSONObject(text)
          val message = parsed.getJSONObject("message")
          when (message.getString("type")) {
            "pairing_challenge" -> {
              val nonce = message.getString("nonce")
              val guestFp = identity.fingerprintSha256
              val proof = hmac(
                body.getString("code") + ":" + body.getString("pairingSessionId"),
                nonce + ":" + identity.deviceId + ":" + guestFp
              )
              webSocket.send(
                envelope(
                  JSONObject()
                    .put("type", "pairing_proof")
                    .put("pairingSessionId", body.getString("pairingSessionId"))
                    .put("nonce", nonce)
                    .put("proofHex", proof)
                    .put(
                      "guest",
                      JSONObject()
                        .put("deviceId", identity.deviceId)
                        .put("displayName", identity.displayName)
                        .put("fingerprintSha256", identity.fingerprintSha256)
                        .put("publicKeySpkiHex", identity.publicKeySpkiHex)
                    )
                ).toString()
              )
            }
            "pairing_result" -> {
              if (message.optBoolean("ok")) {
                sessionToken = message.getString("sessionToken")
                val hostIdentity = message.getJSONObject("host")
                peerDeviceId = hostIdentity.getString("deviceId")
                paired.put(hostIdentity.put("sessionToken", sessionToken))
              } else {
                error = message.optString("errorCode", "PAIRING_INVALID")
              }
              latch.countDown()
            }
            "transfer_error" -> {
              error = message.optString("message", "pairing failed")
              latch.countDown()
            }
          }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
          error = t.message
          latch.countDown()
        }
      }
    )
    latch.await(20, TimeUnit.SECONDS)
    ws.cancel()
    if (error != null) {
      throw IllegalStateException(error)
    }
    return "paired"
  }

  fun sendUris(target: JSONObject, uris: List<Uri>): String {
    if (sessionToken.isEmpty()) {
      throw IllegalStateException("Pair a Windows device first")
    }
    val host = target.getString("host")
    val port = target.getInt("port")
    val files = JSONArray()
    val fileInfos = mutableListOf<FileInfo>()
    uris.forEachIndexed { index, uri ->
      val size = try {
        context.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: 0L
      } catch (_: Exception) {
        0L
      }
      val relativePath = uri.lastPathSegment ?: "file-$index"
      files.put(
        JSONObject()
          .put("index", index)
          .put("relativePath", relativePath)
          .put("sizeBytes", size)
      )
      fileInfos.add(FileInfo(uri, index, relativePath, size))
    }
    val totalBytes = fileInfos.sumOf { it.size }
    val transferId = UUID.randomUUID().toString()
    val expected = target.optString("expectedFingerprint").ifBlank {
      paired.optJSONObject(0)?.optString("fingerprintSha256").orEmpty()
    }
    val client = pinnedClient(expected.lowercase())
    val latch = CountDownLatch(1)
    var error: String? = null
    val ws = client.newWebSocket(
      Request.Builder().url("wss://$host:$port").build(),
      object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
          webSocket.send(
            envelope(
              JSONObject()
                .put("type", "auth_hello")
                .put("deviceId", deviceId)
                .put("sessionToken", sessionToken)
                .put("nonce", UUID.randomUUID().toString().replace("-", ""))
            ).toString()
          )
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          val message = JSONObject(text).getJSONObject("message")
          when (message.getString("type")) {
            "auth_result" -> {
              if (!message.optBoolean("ok")) {
                error = "auth failed"
                latch.countDown()
                return
              }
              webSocket.send(
                envelope(
                  JSONObject()
                    .put("type", "transfer_offer")
                    .put("transferId", transferId)
                    .put("files", files)
                    .put("totalBytes", totalBytes)
                ).toString()
              )
            }
            "transfer_decision" -> {
              if (!message.optBoolean("accepted")) {
                error = "declined"
                latch.countDown()
                return
              }
              try {
                fileInfos.forEachIndexed { index, info ->
                  val streamBody = object : okhttp3.RequestBody() {
                    override fun contentType() = "application/octet-stream".toMediaType()
                    override fun writeTo(sink: okio.BufferedSink) {
                      context.contentResolver.openInputStream(info.uri)?.use { input ->
                        val buffer = ByteArray(64 * 1024)
                        var read = 0
                        while (input.read(buffer).also { read = it } != -1) {
                          if (read > 0) {
                            sink.write(buffer, 0, read)
                          }
                        }
                      } ?: throw IllegalStateException("Stream unavailable for ${info.uri}")
                    }
                  }
                  val put = Request.Builder()
                    .url("https://$host:$port/v1/transfers/$transferId/files/$index")
                    .put(streamBody)
                    .header("Authorization", "Bearer $sessionToken")
                    .build()
                  client.newCall(put).execute().use { response ->
                    if (!response.isSuccessful) {
                      throw IllegalStateException("upload failed: ${response.code}")
                    }
                  }
                }
                latch.countDown()
              } catch (ex: Exception) {
                error = ex.message
                latch.countDown()
              }
            }
            "transfer_error" -> {
              error = message.optString("message")
              latch.countDown()
            }
          }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
          error = t.message
          latch.countDown()
        }
      }
    )
    latch.await(120, TimeUnit.SECONDS)
    ws.cancel()
    if (error != null) {
      throw IllegalStateException(error)
    }
    return transferId
  }

  fun decide(transferId: String, accepted: Boolean) {
    incomingApprovals[transferId] = accepted
  }

  fun receiveFile(transferId: String, index: Int, token: String?, length: Long, input: java.io.InputStream): JSONObject {
    if (token.isNullOrEmpty()) {
      throw IllegalArgumentException("UNAUTHENTICATED")
    }
    val pairedRecord = paired.optJSONObject(0) ?: throw IllegalArgumentException("UNAUTHENTICATED")
    if (token != pairedRecord.optString("sessionToken", "")) {
      throw IllegalArgumentException("UNAUTHENTICATED")
    }
    val approved = incomingApprovals[transferId]
    if (approved != true) {
      throw IllegalArgumentException("TRANSFER_STATE_INVALID")
    }
    val digest = MessageDigest.getInstance("SHA-256")
    val destinationDir = context.getExternalFilesDir(null) ?: context.filesDir
    val tmpDir = File(destinationDir, ".nexashare-tmp/$transferId")
    tmpDir.mkdirs()
    val tmpFile = File(tmpDir, "$index.part")
    tmpFile.outputStream().use { out ->
      val buffer = ByteArray(64 * 1024)
      var remaining = length
      var written = 0L
      while (remaining > 0) {
        val toRead = minOf(buffer.size.toLong(), remaining).toInt()
        val n = input.read(buffer, 0, toRead)
        if (n < 0) {
          throw IllegalArgumentException("SIZE_MISMATCH")
        }
        digest.update(buffer, 0, n)
        out.write(buffer, 0, n)
        remaining -= n
        written += n
      }
      if (written != length) {
        throw IllegalArgumentException("SIZE_MISMATCH")
      }
    }
    val sha256Hex = digest.digest().joinToString("") { "%02x".format(it) }
    val finalDir = File(destinationDir, "Downloads")
    finalDir.mkdirs()
    val finalFile = File(finalDir, "file-$index")
    tmpFile.renameTo(finalFile)
    return JSONObject()
      .put("ok", true)
      .put("sha256Hex", sha256Hex)
      .put("sizeBytes", length)
  }

  private fun envelope(message: JSONObject): JSONObject =
    JSONObject()
      .put("v", 1)
      .put("requestId", UUID.randomUUID().toString())
      .put("sentAt", System.currentTimeMillis())
      .put("message", message)

  private fun hmac(secret: String, nonce: String): String {
    val mac = javax.crypto.Mac.getInstance("HmacSHA256")
    mac.init(javax.crypto.spec.SecretKeySpec(secret.toByteArray(), "HmacSHA256"))
    return mac.doFinal(nonce.toByteArray()).joinToString("") { "%02x".format(it) }
  }

  private fun pinnedClient(expectedFingerprint: String): OkHttpClient {
    // Note: hostname verification is overridden because this application uses
    // fingerprint-pinned self-signed TLS certificates for peer identity.
    // The fingerprint comparison in checkServerTrusted is mandatory and fails closed.
    val trustManager = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = Unit
      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        val cert = chain.first()
        val digest = MessageDigest.getInstance("SHA-256").digest(cert.encoded)
        val actual = digest.joinToString("") { "%02x".format(it) }
        if (expectedFingerprint.length != 64 || actual != expectedFingerprint) {
          throw java.security.cert.CertificateException("fingerprint mismatch")
        }
      }
      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
    val ssl = SSLContext.getInstance("TLS")
    ssl.init(null, arrayOf<TrustManager>(trustManager), SecureRandom())
    return OkHttpClient.Builder()
      .sslSocketFactory(ssl.socketFactory, trustManager)
      .hostnameVerifier { _, _ -> true }
      .build()
  }
}
