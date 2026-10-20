package com.nexashare.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder

class TransferForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    val channel = NotificationChannel("transfers", "NexaShare transfers", NotificationManager.IMPORTANCE_LOW)
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    val notification = Notification.Builder(this, "transfers")
      .setContentTitle("NexaShare")
      .setContentText("Listening for local transfers")
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .build()
    startForeground(1, notification)
  }
}
