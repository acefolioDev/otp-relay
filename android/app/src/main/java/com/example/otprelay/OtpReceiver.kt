package com.example.otprelay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

class OtpReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val prefs = context.getSharedPreferences("relay", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("enabled", false)) return
        val allowed = (prefs.getString("senders", "") ?: "")
            .split(',').map { it.trim() }.filter { it.isNotEmpty() }
        if (allowed.isEmpty()) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isEmpty()) return
        val sender = messages.first().originatingAddress ?: return
        if (messages.any { it.originatingAddress != sender }) return
        val text = messages.joinToString(separator = "") { it.displayMessageBody ?: "" }
        val code = OtpExtractor.extractApproved(sender, allowed, text) ?: return
        val pending = goAsync()
        val completed = java.util.concurrent.atomic.AtomicBoolean(false)
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        val finish = Runnable { if (completed.compareAndSet(false, true)) pending.finish() }
        handler.postDelayed(finish, 9000)
        Upload.uploadAsync(context.applicationContext, code) {
            handler.removeCallbacks(finish)
            finish.run()
        }
    }
}
