package com.example.otprelay

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.*

class MainActivity : Activity() {
    private var forwarding: CheckBox? = null
    @Deprecated("Android Activity result bridge")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 20 || resultCode != RESULT_OK) return
        try {
            val uri = data?.data ?: return
            val bytes = contentResolver.openInputStream(uri)?.use { input ->
                val buffer = ByteArray(4097)
                var count = 0
                while (count < buffer.size) {
                    val n = input.read(buffer, count, buffer.size - count)
                    if (n <= 0) break
                    count += n
                }
                require(count <= 4096)
                buffer.copyOf(count)
            } ?: return
            val json = bytes.toString(Charsets.UTF_8)
            RelayPairing.parse(json)
            SecretStore.save(this, json)
            getSharedPreferences("relay", MODE_PRIVATE).edit().putString("url", BuildConfig.RELAY_BASE_URL).apply()
            Toast.makeText(this, "Pairing imported. Approve senders before enabling forwarding.", Toast.LENGTH_LONG).show()
        } catch (_: Exception) {
            Toast.makeText(this, "Unable to import private android.json", Toast.LENGTH_LONG).show()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 12 && grantResults.firstOrNull() != PackageManager.PERMISSION_GRANTED) {
            getSharedPreferences("relay", MODE_PRIVATE).edit().putBoolean("enabled", false).apply()
            forwarding?.isChecked = false
            Toast.makeText(this, "SMS permission denied; automatic forwarding is off", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
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
            setText(R.string.introduction)
            textSize = 18f
        })
        val url = field("HTTPS relay URL", preferences.getString("url", BuildConfig.RELAY_BASE_URL) ?: BuildConfig.RELAY_BASE_URL)
        val pairingInput = field("Paste private android.json (blank keeps existing pairing)", "").apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val senders = field("Allowed sender IDs (comma separated)", preferences.getString("senders", "") ?: "")
        val enabled = CheckBox(this).apply {
            setText(R.string.enable_forwarding)
            isChecked = preferences.getBoolean("enabled", false)
        }
        forwarding = enabled
        root.addView(enabled)
        root.addView(Button(this).apply {
            setText(R.string.import_pairing)
            setOnClickListener {
                val intent = android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(android.content.Intent.CATEGORY_OPENABLE)
                    type = "application/json"
                }
                startActivityForResult(intent, 20)
            }
        })
        val save = Button(this).apply { setText(R.string.save_configuration) }
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
        val send = Button(this).apply { setText(R.string.send_test) }
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
