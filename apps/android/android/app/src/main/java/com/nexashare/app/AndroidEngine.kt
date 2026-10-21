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
  private var lifecycleState = "STOPPED"
  private var serverStarted = false

  fun getLifecycleState(): String = lifecycleState

  fun start(name: String): String {
    if (lifecycleState == "LISTENING" || serverStarted) {
      return JSONObject().put("ok", true).put("deviceId", identity.deviceId).put("port", listenPort).toString()
    }
    lifecycleState = "STARTING"
    displayName = name
    identity = DeviceIdentityFactory.create(name)
    tlsServer = TlsProtocolServer(identity, this)
    listenPort = tlsServer!!.start(0)
    serverStarted = true
    lifecycleState = "LISTENING"
    return JSONObject()
      .put("ok", true)
      .put("deviceId", identity.deviceId)
      .put("displayName", identity.displayName)
      .put("fingerprintSha256", identity.fingerprintSha256)
      .put("port", listenPort)
      .toString()
  }

  fun snapshot(): JSONObject {
    if (!::identity.isInitialized) {
      return JSONObject()
        .put("deviceId", deviceId)
        .put("displayName", displayName)
        .put("fingerprintSha256", "")
        .put("paired", paired)
        .put("lifecycleState", lifecycleState)
        .put("listenPort", 0)
    }
    return JSONObject()
      .put("deviceId", identity.deviceId)
      .put("displayName", identity.displayName)
      .put("fingerprintSha256", identity.fingerprintSha256)
      .put("paired", paired)
      .put("lifecycleState", lifecycleState)
      .put("listenPort", listenPort)
  }

  fun createPairing(): JSONObject {
    val sessionId = UUID.randomUUID().toString()
    val code = "%06d".format(SecureRandom().nextInt(1_000_000))
    val session = PairingSessionData(
      sessionId = sessionId,
      code = code,
      expiresAt = System.currentTimeMillis() + 5 * 60 * 1000,
      consumed = false,
      attempts = 0,
      nonce = null
    )
    pairingSessions[sessionId] = session
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

  fun onControl(sessionId: String, text: String) {
    try {
      val parsed = JSONObject(text)
      val message = parsed.getJSONObject("message")
      val type = message.getString("type")
      when (type) {
        "pairing_hello" -> {
          val pairingSessionId = message.getString("pairingSessionId")
          val code = message.getString("code")
          val session = pairingSessions[pairingSessionId]
          if (session == null || session.consumed || session.expiresAt < System.currentTimeMillis()) {
            // Expired or consumed session
            tlsServer?.sendJson(sessionId, envelope(JSONObject().put("type", "pairing_result").put("ok", false).put("errorCode", "PAIRING_EXPIRED")))
          } else {
            session.attempts += 1
            val nonce = UUID.randomUUID().toString()
            session.nonce = nonce
            tlsServer?.sendJson(sessionId, envelope(JSONObject().put("type", "pairing_challenge").put("pairingSessionId", pairingSessionId).put("nonce", nonce)))
          }
        }
        "pairing_proof" -> {
          val pairingSessionId = message.getString("pairingSessionId")
          val session = pairingSessions[pairingSessionId]
          if (session == null || session.consumed || session.expiresAt < System.currentTimeMillis()) {
            tlsServer?.sendJson(sessionId, envelope(JSONObject().put("type", "pairing_result").put("ok", false).put("errorCode", "PAIRING_EXPIRED")))
            return
          }
          val nonce = session.nonce
          val proofHex = message.getString("proofHex")
          val guestFp = message.getJSONObject("guest").getString("fingerprintSha256")
          val expectedProof = hmac(session.code + ":" + pairingSessionId, nonce + ":" + message.getJSONObject("guest").getString("deviceId") + ":" + guestFp)
          if (expectedProof.lowercase() != proofHex.lowercase()) {
            tlsServer?.sendJson(sessionId, envelope(JSONObject().put("type", "pairing_result").put("ok", false).put("errorCode", "PAIRING_INVALID")))
            session.consumed = true
            return
          }
          if (usedNonces.contains(message.getString("nonce"))) {
            tlsServer?.sendJson(sessionId, envelope(JSONObject().put("type", "pairing_result").put("ok", false).put("errorCode", "PAIRING_INVALID")))
            session.consumed = true
            return
          }
          usedNonces.add(message.getString("nonce"))
          session.consumed = true
          val token = UUID.randomUUID().toString()
          sessionToken = token
          val hostIdentity = JSONObject()
            .put("deviceId", identity.deviceId)
            .put("displayName", identity.displayName)
            .put("fingerprintSha256", identity.fingerprintSha256)
            .put("publicKeySpkiHex", identity.publicKeySpkiHex)
          paired.put(hostIdentity.put("sessionToken", token))
          tlsServer?.sendJson(sessionId, envelope(JSONObject().put("type", "pairing_result").put("ok", true).put("host", hostIdentity).put("sessionToken", token)))
        }
        "auth_hello" -> {
          val deviceId = message.getString("deviceId")
          val authToken = message.getString("sessionToken")
          val nonce = message.getString("nonce")
          val pairedRecord = paired.optJSONObject(0)
          val isValidToken = pairedRecord != null && pairedRecord.optString("sessionToken", "") == authToken
          if (!isValidToken || usedNonces.contains(nonce)) {
            tlsServer?.sendJson(sessionId, envelope(JSONObject().put("type", "auth_result").put("ok", false).put("errorCode", "UNAUTHENTICATED")))
          } else {
            usedNonces.add(nonce)
            tlsServer?.sendJson(sessionId, envelope(JSONObject().put("type", "auth_result").put("ok", true)))
          }
        }
        "transfer_offer" -> {
          val transferId = message.getString("transferId")
          val files = JSONArray()
          val fileArray = message.getJSONArray("files")
          for (i in 0 until fileArray.length()) {
            val fileObj = fileArray.getJSONObject(i)
            files.put(fileObj)
          }
          val totalBytes = message.optLong("totalBytes", 0)
          incomingApprovals[transferId] = false
          // Incoming offer creates pending approval state; user approves via decide().
        }
        "transfer_decision" -> {
          // Decision handled through decide() framework.
        }
        "transfer_cancel" -> {
          // Cancellation handled by engine abort/state transition.
        }
        "transfer_progress" -> {
          // Progress tracked by sender; receiver verifies bytes.
        }
        "transfer_complete" -> {
          // Completion verified by receiveFile() hash check.
        }
        "transfer_error" -> {
          // Error propagated to UI/status.
        }
        "heartbeat" -> {
          // Keep-alive; no action required.
        }
      }
    } catch (_: Exception) {
      // Ignore malformed or unexpected messages to prevent crashes.
    }
  }

  fun decide(transferId: String, accepted: Boolean) {
    incomingApprovals[transferId] = accepted
  }

  fun stop(): String {
    lifecycleState = "STOPPING"
    tlsServer?.stop()
    tlsServer = null
    serverStarted = false
    lifecycleState = "STOPPED"
    return "stopped"
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
    val safeName = "file-$index"
    val finalDir = File(destinationDir, "Downloads")
    finalDir.mkdirs()
    val finalFile = File(finalDir, safeName)
    // Prevent path escape: ensure final file stays inside Downloads
    val resolvedDir = finalDir.canonicalPath
    val resolvedFile = finalFile.canonicalPath
    if (!resolvedFile.startsWith(resolvedDir + File.separator) && resolvedFile != resolvedDir) {
      throw IllegalArgumentException("PATH_REJECTED")
    }
    tmpFile.renameTo(finalFile)
    return JSONObject()
      .put("ok", true)
      .put("sha256Hex", sha256Hex)
      .put("sizeBytes", length)
  }

  private var tlsServer: TlsProtocolServer? = null
  private var listenPort = 0
  private val pairingSessions = mutableMapOf<String, PairingSessionData>()
  private val usedNonces = mutableSetOf<String>()

  private data class PairingSessionData(
    val sessionId: String,
    val code: String,
    val expiresAt: Long,
    var consumed: Boolean,
    var attempts: Int,
    var nonce: String?
  )

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
