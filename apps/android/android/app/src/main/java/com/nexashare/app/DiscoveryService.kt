package com.nexashare.app

import java.net.DatagramPacket
import java.net.InetAddress
import java.net.MulticastSocket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class DiscoveryService(
  private val identity: DeviceIdentity,
  private val port: Int = 19528,
  private val multicast: String = "239.255.90.90"
) {
  private val devices = ConcurrentHashMap<String, DiscoveredDeviceInfo>()
  private var socket: MulticastSocket? = null
  private var running = false
  private val pool = Executors.newCachedThreadPool()
  private var announceTimer: java.util.Timer? = null
  private var expireTimer: java.util.Timer? = null

  data class DiscoveredDeviceInfo(
    val deviceId: String,
    val displayName: String,
    val fingerprintSha256: String,
    val port: Int,
    val address: String,
    val lastSeenAt: Long
  )

  fun start() {
    try {
      val group = InetAddress.getByName(multicast)
      val s = MulticastSocket(port)
      s.joinGroup(group)
      s.soTimeout = 2000
      socket = s
      running = true
      pool.execute { listen() }
      announceTimer = java.util.Timer("announce", true).apply {
        scheduleAtFixedRate(object : java.util.TimerTask() {
          override fun run() { announce() }
        }, 0, 2000)
      }
      expireTimer = java.util.Timer("expire", true).apply {
        scheduleAtFixedRate(object : java.util.TimerTask() {
          override fun run() { expire() }
        }, 2000, 2000)
      }
    } catch (e: Exception) {
      // Discovery unavailable on this network; manual pairing still works.
    }
  }

  fun stop() {
    running = false
    announceTimer?.cancel()
    expireTimer?.cancel()
    announceTimer = null
    expireTimer = null
    try {
      socket?.leaveGroup(InetAddress.getByName(multicast))
    } catch (_: Exception) {}
    socket?.close()
    socket = null
    pool.shutdownNow()
    devices.clear()
  }

  fun list(): List<DiscoveredDeviceInfo> {
    return devices.values.filter { it.deviceId != identity.deviceId }
  }

  private fun listen() {
    while (running && socket != null) {
      try {
        val buffer = ByteArray(1024)
        val packet = DatagramPacket(buffer, buffer.size)
        socket!!.receive(packet)
        val text = String(buffer, 0, packet.length, Charsets.UTF_8)
        if (text.length > 1024 * 1024) continue
        parseAnnouncement(text, packet.address.hostAddress)
      } catch (_: Exception) {
        if (!running) break
      }
    }
  }

  private fun parseAnnouncement(raw: String, address: String) {
    try {
      val obj = org.json.JSONObject(raw)
      if (obj.optInt("v", 0) != 1) return
      if (obj.optString("type") != "announce") return
      val id = obj.getString("deviceId")
      if (id == identity.deviceId) return
      val info = DiscoveredDeviceInfo(
        deviceId = id,
        displayName = obj.optString("displayName", id),
        fingerprintSha256 = obj.optString("fingerprintSha256", ""),
        port = obj.optInt("port", 19529),
        address = address,
        lastSeenAt = System.currentTimeMillis()
      )
      devices[id] = info
    } catch (_: Exception) {
      // Ignore malformed announcements.
    }
  }

  private fun announce() {
    val s = socket ?: return
    try {
      val obj = org.json.JSONObject()
        .put("v", 1)
        .put("type", "announce")
        .put("deviceId", identity.deviceId)
        .put("displayName", identity.displayName)
        .put("port", port)
        .put("fingerprintSha256", identity.fingerprintSha256)
        .put("capabilities", org.json.JSONArray().put("files").put("folders"))
        .put("protocolMin", 1)
        .put("protocolMax", 1)
      val payload = obj.toString().toByteArray(Charsets.UTF_8)
      s.send(DatagramPacket(payload, payload.size, InetAddress.getByName(multicast), port))
    } catch (_: Exception) {
      // Multicast unavailable; manual pairing remains possible.
    }
  }

  private fun expire() {
    val now = System.currentTimeMillis()
    val ttl = 12000L
    val toRemove = mutableListOf<String>()
    for ((id, info) in devices) {
      if (now - info.lastSeenAt > ttl) {
        toRemove.add(id)
      }
    }
    for (id in toRemove) {
      devices.remove(id)
    }
  }
}
