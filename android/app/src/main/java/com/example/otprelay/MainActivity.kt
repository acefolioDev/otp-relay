package com.example.otprelay

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.*

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val preferences = getSharedPreferences("relay", MODE_PRIVATE)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 36, 36, 36)
        }
        fun field(hint: String, value: String): EditText = EditText(this).also {
            it.hint = hint
            it.setText(value)
            root.addView(it)
        }
        root.addView(TextView(this).apply {
            text = "OTP Relay — only use on phones and accounts you own."
            textSize = 18f
        })
        val url = field("HTTPS relay URL", preferences.getString("url", "") ?: "")
        val pairingInput = field("Paste private android.json (blank keeps existing pairing)", "").apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val senders = field("Allowed sender IDs (comma separated)", preferences.getString("senders", "") ?: "")
        val enabled = CheckBox(this).apply {
            text = "Automatically forward OTPs from allowed senders"
            isChecked = preferences.getBoolean("enabled", false)
        }
        root.addView(enabled)
        val save = Button(this).apply { text = "Save configuration" }
        root.addView(save)
        save.setOnClickListener {
            val host = url.text.toString().trim().trimEnd('/')
            val uri = runCatching { java.net.URI(host) }.getOrNull()
            if (uri?.scheme != "https" || uri.host == null || uri.rawUserInfo != null ||
                uri.rawQuery != null || uri.rawFragment != null || uri.path !in listOf("", "/")) {
                Toast.makeText(this, "HTTPS URL required", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            if (enabled.isChecked && senders.text.isBlank()) {
                Toast.makeText(this, "Set at least one allowed sender first", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            val pairingJson = pairingInput.text.toString().ifBlank { SecretStore.read(this) }
            if (runCatching { RelayPairing.parse(pairingJson) }.isFailure) {
                Toast.makeText(this, "Import valid private android.json pairing data", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            if (runCatching { SecretStore.save(this, pairingJson) }.isFailure) {
                Toast.makeText(this, "Unable to save encrypted pairing", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            preferences.edit()
                .putString("url", host)
                .putString("senders", senders.text.toString())
                .putBoolean("enabled", enabled.isChecked)
                .apply()
            pairingInput.text.clear()
            if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS), 12)
            } else {
                Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
            }
        }
        val code = field("Synthetic test code (numeric or mixed case)", "")
        val send = Button(this).apply { text = "Send test code to iPhone" }
        root.addView(send)
        send.setOnClickListener {
            val candidate = code.text.toString().trim()
            if (!candidate.matches(Regex("[A-Za-z0-9]{4,32}"))) {
                Toast.makeText(this, "Enter 4-32 letters or digits", Toast.LENGTH_SHORT).show()
            } else {
                Upload.uploadAsync(this, candidate)
                Toast.makeText(this, "Encrypted upload requested", Toast.LENGTH_SHORT).show()
            }
        }
        setContentView(ScrollView(this).apply { addView(root) })
    }
}
