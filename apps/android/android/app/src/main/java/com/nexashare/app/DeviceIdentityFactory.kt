package com.nexashare.app

import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Security
import java.security.cert.X509Certificate
import java.util.Date
import java.util.UUID
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext

data class DeviceIdentity(
  val deviceId: String,
  val displayName: String,
  val fingerprintSha256: String,
  val publicKeySpkiHex: String,
  val certificate: X509Certificate,
  val sslContext: SSLContext
)

object DeviceIdentityFactory {
  init {
    if (Security.getProvider("BC") == null) {
      Security.addProvider(BouncyCastleProvider())
    }
  }

  fun create(displayName: String): DeviceIdentity {
    val deviceId = UUID.randomUUID().toString()
    val keyPair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
    val now = Date()
    val until = Date(now.time + 825L * 24 * 60 * 60 * 1000)
    val builder = JcaX509v3CertificateBuilder(
      X500Name("CN=nexashare-$deviceId"),
      BigInteger(64, SecureRandom()),
      now,
      until,
      X500Name("CN=nexashare-$deviceId"),
      keyPair.public
    )
    val signer = JcaContentSignerBuilder("SHA256WithRSA").build(keyPair.private)
    val cert = JcaX509CertificateConverter().setProvider("BC").getCertificate(builder.build(signer))
    val fingerprint = sha256Hex(cert.encoded)
    val spki = keyPair.public.encoded.joinToString("") { b -> "%02x".format(b) }
    val store = KeyStore.getInstance("PKCS12").apply { load(null, null) }
    val password = "nexashare".toCharArray()
    store.setKeyEntry("nexa", keyPair.private, password, arrayOf(cert))
    val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
    kmf.init(store, password)
    val ssl = SSLContext.getInstance("TLS")
    ssl.init(kmf.keyManagers, null, SecureRandom())
    return DeviceIdentity(deviceId, displayName, fingerprint, spki, cert, ssl)
  }

  fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
