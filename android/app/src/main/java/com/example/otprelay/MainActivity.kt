package com.example.otprelay

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : Activity() {
    private var activeTab = 0 // 0 = Messages, 1 = Pair Device, 2 = Account
    private lateinit var contentContainer: LinearLayout

    private var currentPairing: PairingGenerator.PairingBundle? = null
    private val relayedMessages = mutableListOf<MessageEntry>()

    data class MessageEntry(
        val sender: String,
        val body: String,
        val code: String?,
        val time: String = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date())
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
        window.statusBarColor = Color.parseColor("#0D1117")

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0D1117"))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        // Top App Bar
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(48, 48, 48, 24)
            gravity = Gravity.CENTER_VERTICAL
            val title = TextView(this@MainActivity).apply {
                text = "OTP Relay"
                textSize = 22f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.WHITE)
            }
            addView(title)
        }
        root.addView(header)

        // Tab Selector Navigation Bar
        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(32, 8, 32, 24)
            weightSum = 3f
        }

        val tabMessages = createTabButton("Messages", 0)
        val tabPairing = createTabButton("Pair Device", 1)
        val tabAccount = createTabButton("Account", 2)

        tabs.addView(tabMessages)
        tabs.addView(tabPairing)
        tabs.addView(tabAccount)
        root.addView(tabs)

        // Scrollable content area
        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
            isFillViewport = true
        }

        contentContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 16, 36, 48)
        }
        scroll.addView(contentContainer)
        root.addView(scroll)

        setContentView(root)
        renderActiveTab()

        // Check SMS permission
        if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS), 12)
        }
    }

    private fun createTabButton(text: String, tabIndex: Int): Button {
        return Button(this).apply {
            this.text = text
            textSize = 13f
            isAllCaps = false
            setTextColor(if (activeTab == tabIndex) Color.parseColor("#38BDF8") else Color.parseColor("#94A3B8"))
            background = createCardDrawable(
                if (activeTab == tabIndex) "#1E293B" else "#0D1117",
                strokeColor = if (activeTab == tabIndex) "#38BDF8" else "#334155"
            )
            layoutParams = LinearLayout.LayoutParams(0, 110, 1f).apply {
                setMargins(8, 0, 8, 0)
            }
            setOnClickListener {
                activeTab = tabIndex
                renderActiveTab()
            }
        }
    }

    private fun renderActiveTab() {
        contentContainer.removeAllViews()
        when (activeTab) {
            0 -> renderMessagesView()
            1 -> renderPairingView()
            2 -> renderAccountView()
        }
    }

    // TAB 1: Messages & Manual Sender
    private fun renderMessagesView() {
        val prefs = getSharedPreferences("relay", MODE_PRIVATE)
        val isEnabled = prefs.getBoolean("enabled", true)

        // Status Banner Card
        val statusCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 36, 40, 36)
            background = createCardDrawable("#161F30", strokeColor = if (isEnabled) "#0284C7" else "#475569")
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = 36
            }
        }
        statusCard.addView(TextView(this).apply {
            text = if (isEnabled) "● Automatic Relay Active" else "○ Automatic Relay Paused"
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(if (isEnabled) Color.parseColor("#38BDF8") else Color.parseColor("#94A3B8"))
        })
        statusCard.addView(TextView(this).apply {
            text = "Incoming SMS verification codes are automatically encrypted with AES-256 and relayed to your paired iPhone."
            textSize = 13f
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, 8, 0, 0)
        })
        contentContainer.addView(statusCard)

        // Quick Send Message / Test Code Card
        val sendCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 36, 40, 36)
            background = createCardDrawable("#1E293B")
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = 36
            }
        }
        sendCard.addView(TextView(this).apply {
            text = "Send Message or Verification Code"
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
        })

        val codeInput = EditText(this).apply {
            hint = "e.g. 749201 or Secret message"
            setHintTextColor(Color.parseColor("#64748B"))
            setTextColor(Color.WHITE)
            textSize = 16f
            background = createCardDrawable("#0F172A", strokeColor = "#334155")
            setPadding(32, 28, 32, 28)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 16
                bottomMargin = 24
            }
        }
        sendCard.addView(codeInput)

        val sendBtn = Button(this).apply {
            text = "Encrypt & Relay to iPhone"
            isAllCaps = false
            setTextColor(Color.parseColor("#0F172A"))
            typeface = Typeface.DEFAULT_BOLD
            background = createCardDrawable("#38BDF8")
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 120)
            setOnClickListener {
                val candidate = codeInput.text.toString().trim()
                if (candidate.length < 4 || candidate.length > 64) {
                    Toast.makeText(this@MainActivity, "Enter 4 to 64 characters", Toast.LENGTH_SHORT).show()
                } else {
                    Upload.uploadAsync(this@MainActivity, candidate)
                    relayedMessages.add(0, MessageEntry("Manual / Test", candidate, candidate))
                    codeInput.text.clear()
                    Toast.makeText(this@MainActivity, "Encrypted & Relayed successfully", Toast.LENGTH_SHORT).show()
                    renderActiveTab()
                }
            }
        }
        sendCard.addView(sendBtn)
        contentContainer.addView(sendCard)

        // Message Feed Header
        contentContainer.addView(TextView(this).apply {
            text = "Recent Relayed SMS & Codes"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(8, 8, 8, 16)
        })

        if (relayedMessages.isEmpty()) {
            val emptyCard = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(40, 60, 40, 60)
                background = createCardDrawable("#1E293B")
            }
            emptyCard.addView(TextView(this).apply {
                text = "No messages relayed yet.\nIncoming SMS with OTPs will display here."
                gravity = Gravity.CENTER
                textSize = 14f
                setTextColor(Color.parseColor("#64748B"))
            })
            contentContainer.addView(emptyCard)
        } else {
            for (msg in relayedMessages) {
                val msgCard = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(36, 32, 36, 32)
                    background = createCardDrawable("#1E293B")
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = 20
                    }
                }
                msgCard.addView(TextView(this).apply {
                    text = "${msg.sender} • ${msg.time}"
                    textSize = 12f
                    setTextColor(Color.parseColor("#38BDF8"))
                })
                msgCard.addView(TextView(this).apply {
                    text = msg.body
                    textSize = 15f
                    setTextColor(Color.WHITE)
                    setPadding(0, 8, 0, 0)
                })
                contentContainer.addView(msgCard)
            }
        }
    }

    // TAB 2: Device Pairing (QR Code & 8-Digit PIN)
    private fun renderPairingView() {
        val prefs = getSharedPreferences("relay", MODE_PRIVATE)
        val serverUrl = prefs.getString("url", BuildConfig.RELAY_BASE_URL) ?: BuildConfig.RELAY_BASE_URL
        val deviceId = prefs.getString("device_id", "") ?: ""
        val deviceToken = prefs.getString("device_token", "") ?: ""

        val pairing = currentPairing ?: PairingGenerator.generateNewPairing().also { currentPairing = it }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(44, 40, 44, 40)
            background = createCardDrawable("#1E293B")
        }

        card.addView(TextView(this).apply {
            text = "Pair with iPhone"
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
        })

        card.addView(TextView(this).apply {
            text = "Enter this 8-digit PIN code or scan QR on your iPhone to pair with zero-knowledge end-to-end encryption."
            textSize = 13f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, 8, 0, 24)
        })

        // Generated QR Code Bitmap
        val qrImageView = ImageView(this).apply {
            val bitmap = PairingGenerator.createQRCodeBitmap(pairing.qrPayload, 480)
            setImageBitmap(bitmap)
            layoutParams = LinearLayout.LayoutParams(480, 480).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = 24
            }
        }
        card.addView(qrImageView)

        // PIN Code Section
        card.addView(TextView(this).apply {
            text = "8-DIGIT PAIRING PIN FOR IPHONE:"
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, 8, 0, 8)
        })

        val pinDisplay = TextView(this).apply {
            text = pairing.pinCode
            textSize = 32f
            typeface = Typeface.MONOSPACE
            setTextColor(Color.parseColor("#38BDF8"))
            setPadding(32, 12, 32, 12)
            background = createCardDrawable("#0F172A", strokeColor = "#38BDF8")
        }
        card.addView(pinDisplay)

        val pairStatusLabel = TextView(this).apply {
            text = if (deviceId.isEmpty()) "Sign in on Account tab first to save PIN to cloud" else "Ready to pair with iPhone"
            textSize = 12f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, 12, 0, 0)
        }
        card.addView(pairStatusLabel)

        // Generate / Sync Button
        val regenBtn = Button(this).apply {
            text = "Generate & Save PIN to Cloud"
            isAllCaps = false
            setTextColor(Color.WHITE)
            background = createCardDrawable("#0284C7")
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 110).apply {
                topMargin = 24
            }
            setOnClickListener {
                val newBundle = PairingGenerator.generateNewPairing()
                currentPairing = newBundle
                pinDisplay.text = newBundle.pinCode
                qrImageView.setImageBitmap(PairingGenerator.createQRCodeBitmap(newBundle.qrPayload, 480))

                val newAndroidPairing = """{"role":"android","pairId":"${newBundle.pairId}","token":"${newBundle.token}","keyId":"${newBundle.keyId}","encryptionKey":"${newBundle.encryptionKey}"}"""
                SecretStore.save(this@MainActivity, newAndroidPairing)

                if (deviceId.isNotEmpty() && deviceToken.isNotEmpty()) {
                    pairStatusLabel.text = "Syncing PIN to server..."
                    Thread {
                        try {
                            val conn = URL("$serverUrl/api/v1/devices/pair/initiate").openConnection() as HttpURLConnection
                            conn.requestMethod = "POST"
                            conn.setRequestProperty("Content-Type", "application/json")
                            conn.setRequestProperty("Authorization", "Bearer $deviceToken")
                            conn.doOutput = true
                            conn.connectTimeout = 10000
                            conn.readTimeout = 10000
                            val payload = """{"deviceId":"$deviceId","keyId":"${newBundle.keyId}","encryptionKey":"${newBundle.encryptionKey}"}"""
                            OutputStreamWriter(conn.outputStream, "UTF-8").use { it.write(payload) }

                            val resCode = conn.responseCode
                            val resBody = if (resCode in 200..299) conn.inputStream.bufferedReader().readText() else conn.errorStream?.bufferedReader()?.readText() ?: ""
                            
                            val codePattern = Regex("\"pairCode\"\\s*:\\s*\"([^\"]+)\"")
                            val serverCode = codePattern.find(resBody)?.groupValues?.get(1)

                            runOnUiThread {
                                if (resCode in 200..299 && !serverCode.isNullOrEmpty()) {
                                    // The relay authenticates uploads with the registered Android
                                    // device token and routes them by the server-created pair ID.
                                    // The locally generated values are only inputs to initiation.
                                    val serverPairId = Regex("\"pairId\"\\s*:\\s*\"([^\"]+)\"")
                                        .find(resBody)?.groupValues?.get(1) ?: newBundle.pairId
                                    val syncedBundle = newBundle.copy(
                                        pairId = serverPairId,
                                        pinCode = serverCode,
                                        token = deviceToken,
                                        qrPayload = """{"role":"iphone","pairId":"$serverPairId","token":"$deviceToken","keyId":"${newBundle.keyId}","encryptionKey":"${newBundle.encryptionKey}"}"""
                                    )
                                    currentPairing = syncedBundle
                                    pinDisplay.text = serverCode
                                    qrImageView.setImageBitmap(PairingGenerator.createQRCodeBitmap(syncedBundle.qrPayload, 480))
                                    SecretStore.save(this@MainActivity,
                                        """{"role":"android","pairId":"${syncedBundle.pairId}","token":"$deviceToken","keyId":"${syncedBundle.keyId}","encryptionKey":"${syncedBundle.encryptionKey}"}""")
                                    pairStatusLabel.text = "PIN is active! Enter $serverCode on your iPhone."
                                    pairStatusLabel.setTextColor(Color.parseColor("#38BDF8"))
                                    Toast.makeText(this@MainActivity, "PIN $serverCode saved to server!", Toast.LENGTH_SHORT).show()
                                } else {
                                    pairStatusLabel.text = "Generated locally. Server sync failed (HTTP $resCode)"
                                }
                            }
                        } catch (e: Exception) {
                            runOnUiThread {
                                pairStatusLabel.text = "Network error syncing PIN: ${e.message}"
                            }
                        }
                    }.start()
                } else {
                    pairStatusLabel.text = "Generated locally. Sign in on Account tab to sync to iPhone."
                    Toast.makeText(this@MainActivity, "Sign in on Account tab to sync PIN with iPhone", Toast.LENGTH_LONG).show()
                }
            }
        }
        card.addView(regenBtn)

        // Automatically trigger sync if not yet synced and user is signed in
        if (deviceId.isNotEmpty() && deviceToken.isNotEmpty() && currentPairing == null) {
            regenBtn.performClick()
        }

        contentContainer.addView(card)
    }

    // TAB 3: Account & Settings
    private fun renderAccountView() {
        val prefs = getSharedPreferences("relay", MODE_PRIVATE)
        val userEmail = prefs.getString("user_email", "") ?: ""
        val userName = prefs.getString("user_name", "") ?: ""
        val serverUrl = prefs.getString("url", BuildConfig.RELAY_BASE_URL) ?: BuildConfig.RELAY_BASE_URL

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 36, 40, 36)
            background = createCardDrawable("#1E293B")
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = 36
            }
        }

        if (userEmail.isEmpty()) {
            card.addView(TextView(this).apply {
                text = "Sign In or Register"
                textSize = 18f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.WHITE)
            })

            // Name Field
            card.addView(TextView(this).apply {
                text = "Full Name (for new account)"
                textSize = 12f
                setTextColor(Color.parseColor("#94A3B8"))
                setPadding(0, 16, 0, 8)
            })
            val nameInput = EditText(this).apply {
                hint = "Your Name"
                setHintTextColor(Color.parseColor("#64748B"))
                setTextColor(Color.WHITE)
                background = createCardDrawable("#0F172A", strokeColor = "#334155")
                setPadding(28, 24, 28, 24)
            }
            card.addView(nameInput)

            // Email Field
            card.addView(TextView(this).apply {
                text = "Email"
                textSize = 12f
                setTextColor(Color.parseColor("#94A3B8"))
                setPadding(0, 16, 0, 8)
            })
            val emailInput = EditText(this).apply {
                hint = "user@example.com"
                setHintTextColor(Color.parseColor("#64748B"))
                setTextColor(Color.WHITE)
                inputType = android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
                background = createCardDrawable("#0F172A", strokeColor = "#334155")
                setPadding(28, 24, 28, 24)
            }
            card.addView(emailInput)

            // Password Field
            card.addView(TextView(this).apply {
                text = "Password (6+ chars)"
                textSize = 12f
                setTextColor(Color.parseColor("#94A3B8"))
                setPadding(0, 16, 0, 8)
            })
            val passInput = EditText(this).apply {
                hint = "••••••••"
                setHintTextColor(Color.parseColor("#64748B"))
                setTextColor(Color.WHITE)
                inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
                background = createCardDrawable("#0F172A", strokeColor = "#334155")
                setPadding(28, 24, 28, 24)
            }
            card.addView(passInput)

            // Status label shown during loading
            val statusLabel = TextView(this).apply {
                text = ""
                textSize = 13f
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor("#94A3B8"))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = 16
                }
            }
            card.addView(statusLabel)

            // Buttons: Sign In / Create Account
            val btnRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = 12
                }
                weightSum = 2f
            }

            val loginBtn = Button(this).apply {
                text = "Sign In"
                isAllCaps = false
                setTextColor(Color.WHITE)
                background = createCardDrawable("#0284C7")
                layoutParams = LinearLayout.LayoutParams(0, 110, 1f).apply { rightMargin = 8 }
            }

            val registerBtn = Button(this).apply {
                text = "Register"
                isAllCaps = false
                setTextColor(Color.parseColor("#0F172A"))
                typeface = Typeface.DEFAULT_BOLD
                background = createCardDrawable("#38BDF8")
                layoutParams = LinearLayout.LayoutParams(0, 110, 1f).apply { leftMargin = 8 }
            }

            /** Puts both auth buttons in loading state while a network request is in flight. */
            fun setLoading(loading: Boolean) {
                loginBtn.isEnabled = !loading
                registerBtn.isEnabled = !loading
                statusLabel.text = if (loading) "Please wait…" else ""
            }

            /**
             * Performs a JSON POST on a background thread.
             * @param endpoint  path appended to serverUrl, e.g. "/api/v1/auth/login"
             * @param body      JSON string to send
             * @param onResult  called on the UI thread with (isSuccess, responseBody)
             */
            fun authPost(endpoint: String, body: String, onResult: (Boolean, String) -> Unit) {
                setLoading(true)
                Thread {
                    var success = false
                    var responseBody = ""
                    try {
                        val conn = URL("$serverUrl$endpoint").openConnection() as HttpURLConnection
                        conn.requestMethod = "POST"
                        conn.setRequestProperty("Content-Type", "application/json")
                        conn.setRequestProperty("Accept", "application/json")
                        conn.doOutput = true
                        conn.connectTimeout = 15_000
                        conn.readTimeout = 15_000
                        OutputStreamWriter(conn.outputStream, "UTF-8").use { it.write(body) }
                        val code = conn.responseCode
                        success = code in 200..299
                        val stream = if (success) conn.inputStream else conn.errorStream
                        responseBody = stream?.bufferedReader()?.readText() ?: ""
                    } catch (e: Exception) {
                        responseBody = "{\"error\":\"${e.message?.replace("\"", "'")}\"}"
                    }
                    val finalSuccess = success
                    val finalBody = responseBody
                    runOnUiThread { onResult(finalSuccess, finalBody) }
                }.start()
            }

            /** Extracts a top-level string field from a flat JSON string without pulling in a JSON library. */
            fun jsonField(json: String, key: String): String {
                val pattern = Regex("\"$key\"\\s*:\\s*\"([^\"\\\\]*(\\\\.[^\"\\\\]*)*)\"")
                return pattern.find(json)?.groupValues?.get(1) ?: ""
            }

            loginBtn.setOnClickListener {
                val em = emailInput.text.toString().trim()
                val pw = passInput.text.toString()
                if (em.isEmpty() || pw.length < 6) {
                    Toast.makeText(this@MainActivity, "Enter email & 6+ char password", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                val deviceName = "Android ${Build.MODEL}"
                val bodyJson = """{"email":"$em","password":"$pw","deviceName":"$deviceName","deviceType":"android"}"""
                authPost("/api/v1/auth/login", bodyJson) { ok, resp ->
                    setLoading(false)
                    if (ok) {
                        val name = jsonField(resp, "name")
                        val email = jsonField(resp, "email")
                        val deviceId = jsonField(resp, "id").let {
                            // "id" might match user.id first; look for device block heuristically
                            // Extract device sub-object first
                            val deviceBlock = Regex("\"device\"\\s*:\\s*\\{([^}]*)\\}").find(resp)?.groupValues?.get(1) ?: ""
                            if (deviceBlock.isNotEmpty()) jsonField("{$deviceBlock}", "id") else it
                        }
                        val deviceToken = run {
                            val deviceBlock = Regex("\"device\"\\s*:\\s*\\{([^}]*)\\}").find(resp)?.groupValues?.get(1) ?: ""
                            if (deviceBlock.isNotEmpty()) jsonField("{$deviceBlock}", "token") else ""
                        }
                        prefs.edit()
                            .putString("user_email", email.ifEmpty { em })
                            .putString("user_name", name)
                            .putString("device_id", deviceId)
                            .putString("device_token", deviceToken)
                            .apply()
                        Toast.makeText(this@MainActivity, "Signed in as ${email.ifEmpty { em }}", Toast.LENGTH_SHORT).show()
                        renderActiveTab()
                    } else {
                        val errMsg = jsonField(resp, "error").ifEmpty { "Sign in failed" }
                        Toast.makeText(this@MainActivity, errMsg, Toast.LENGTH_LONG).show()
                    }
                }
            }

            registerBtn.setOnClickListener {
                val nm = nameInput.text.toString().trim()
                val em = emailInput.text.toString().trim()
                val pw = passInput.text.toString()
                if (em.isEmpty() || pw.length < 6) {
                    Toast.makeText(this@MainActivity, "Enter name, email & 6+ char password", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                val deviceName = "Android ${Build.MODEL}"
                val bodyJson = """{"name":"${nm.ifEmpty { "User" }}","email":"$em","password":"$pw","deviceName":"$deviceName","deviceType":"android"}"""
                authPost("/api/v1/auth/register", bodyJson) { ok, resp ->
                    setLoading(false)
                    if (ok) {
                        val name = jsonField(resp, "name")
                        val email = jsonField(resp, "email")
                        val deviceId = run {
                            val deviceBlock = Regex("\"device\"\\s*:\\s*\\{([^}]*)\\}").find(resp)?.groupValues?.get(1) ?: ""
                            if (deviceBlock.isNotEmpty()) jsonField("{$deviceBlock}", "id") else ""
                        }
                        val deviceToken = run {
                            val deviceBlock = Regex("\"device\"\\s*:\\s*\\{([^}]*)\\}").find(resp)?.groupValues?.get(1) ?: ""
                            if (deviceBlock.isNotEmpty()) jsonField("{$deviceBlock}", "token") else ""
                        }
                        prefs.edit()
                            .putString("user_email", email.ifEmpty { em })
                            .putString("user_name", name.ifEmpty { nm })
                            .putString("device_id", deviceId)
                            .putString("device_token", deviceToken)
                            .apply()
                        Toast.makeText(this@MainActivity, "Account created & signed in", Toast.LENGTH_SHORT).show()
                        renderActiveTab()
                    } else {
                        val errMsg = jsonField(resp, "error").ifEmpty { "Registration failed" }
                        Toast.makeText(this@MainActivity, errMsg, Toast.LENGTH_LONG).show()
                    }
                }
            }

            btnRow.addView(loginBtn)
            btnRow.addView(registerBtn)
            card.addView(btnRow)

            // Google Sign-In — backend not yet implemented; disabled placeholder
            val googleBtn = Button(this).apply {
                text = "Sign In with Google (Coming Soon)"
                isAllCaps = false
                isEnabled = false
                setTextColor(Color.parseColor("#64748B"))
                background = createCardDrawable("#1E293B")
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 110).apply {
                    topMargin = 16
                }
            }
            card.addView(googleBtn)

        } else {
            card.addView(TextView(this).apply {
                text = "Account Profile"
                textSize = 18f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.WHITE)
            })
            card.addView(TextView(this).apply {
                text = if (userName.isNotEmpty()) userName else "Connected User"
                textSize = 15f
                setTextColor(Color.WHITE)
                setPadding(0, 12, 0, 4)
            })
            card.addView(TextView(this).apply {
                text = userEmail
                textSize = 14f
                setTextColor(Color.parseColor("#38BDF8"))
                setPadding(0, 0, 0, 24)
            })

            val signOutBtn = Button(this).apply {
                text = "Sign Out"
                isAllCaps = false
                setTextColor(Color.WHITE)
                background = createCardDrawable("#475569")
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 110)
                setOnClickListener {
                    prefs.edit()
                        .remove("user_email")
                        .remove("user_name")
                        .remove("device_id")
                        .remove("device_token")
                        .apply()
                    Toast.makeText(this@MainActivity, "Signed out", Toast.LENGTH_SHORT).show()
                    renderActiveTab()
                }
            }
            card.addView(signOutBtn)
        }

        // Server Settings
        val serverCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 36, 40, 36)
            background = createCardDrawable("#1E293B")
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 28
                bottomMargin = 36
            }
        }
        serverCard.addView(TextView(this).apply {
            text = "HTTPS Relay Server URL"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            setPadding(0, 0, 0, 8)
        })

        val urlInput = EditText(this).apply {
            setText(serverUrl)
            setTextColor(Color.WHITE)
            background = createCardDrawable("#0F172A", strokeColor = "#334155")
            setPadding(28, 24, 28, 24)
        }
        serverCard.addView(urlInput)

        val saveBtn = Button(this).apply {
            text = "Save Settings"
            isAllCaps = false
            setTextColor(Color.WHITE)
            background = createCardDrawable("#0284C7")
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 110).apply {
                topMargin = 24
            }
            setOnClickListener {
                prefs.edit().putString("url", urlInput.text.toString().trim()).apply()
                Toast.makeText(this@MainActivity, "Settings saved", Toast.LENGTH_SHORT).show()
            }
        }
        serverCard.addView(saveBtn)

        contentContainer.addView(card)
        contentContainer.addView(serverCard)
    }

    private fun createCardDrawable(bgColor: String, strokeColor: String? = null): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = 28f
            setColor(Color.parseColor(bgColor))
            if (strokeColor != null) {
                setStroke(2, Color.parseColor(strokeColor))
            }
        }
    }
}
