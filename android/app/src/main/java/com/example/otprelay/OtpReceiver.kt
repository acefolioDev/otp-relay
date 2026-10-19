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
        Upload.uploadAsync(context.applicationContext, code)
    }
}
