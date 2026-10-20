package com.nexashare.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

class NexaShareModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx),
  ActivityEventListener {

  private val engine = AndroidEngine(ctx)
  private var pendingSend: Promise? = null
  private var pendingSendTarget: JSONObject? = null

  init {
    ctx.addActivityEventListener(this)
  }

  override fun getName(): String = "NexaShareModule"

  @ReactMethod
  fun start(displayName: String, promise: Promise) {
    CoroutineScope(Dispatchers.IO).launch {
      try {
        val intent = Intent(ctx, TransferForegroundService::class.java)
        ctx.startForegroundService(intent)
        promise.resolve(engine.start(displayName))
      } catch (error: Exception) {
        promise.reject("ENGINE", error)
      }
    }
  }

  @ReactMethod
  fun snapshot(promise: Promise) {
    promise.resolve(engine.snapshot().toString())
  }

  @ReactMethod
  fun createPairing(promise: Promise) {
    promise.resolve(engine.createPairing().toString())
  }

  @ReactMethod
  fun pairGuest(json: String, promise: Promise) {
    CoroutineScope(Dispatchers.IO).launch {
      try {
        promise.resolve(engine.pairGuest(JSONObject(json)))
      } catch (error: Exception) {
        promise.reject("PAIR", error)
      }
    }
  }

  @ReactMethod
  fun pickAndSend(json: String, promise: Promise) {
    val activity = ctx.currentActivity
    if (activity == null) {
      promise.reject("UI", "No activity")
      return
    }
    pendingSend = promise
    pendingSendTarget = JSONObject(json)
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
    }
    activity.startActivityForResult(intent, 7101)
  }

  @ReactMethod
  fun decide(transferId: String, accepted: Boolean, promise: Promise) {
    engine.decide(transferId, accepted)
    promise.resolve("ok")
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != 7101) {
      return
    }
    val promise = pendingSend ?: return
    pendingSend = null
    val target = pendingSendTarget ?: JSONObject()
    val uris = mutableListOf<Uri>()
    data?.data?.let { uris.add(it) }
    data?.clipData?.let { clip ->
      for (i in 0 until clip.itemCount) {
        uris.add(clip.getItemAt(i).uri)
      }
    }
    CoroutineScope(Dispatchers.IO).launch {
      try {
        promise.resolve(engine.sendUris(target, uris))
      } catch (error: Exception) {
        promise.reject("SEND", error)
      }
    }
  }

  override fun onNewIntent(intent: Intent) = Unit
}
