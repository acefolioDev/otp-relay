package com.example.otprelay

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.util.UUID

/** Import only the private android.json generated on the trusted provisioning computer. */
data class RelayPairing(val pairId: String, val token: String, val keyId: String, val encryptionKey: ByteArray) {
    companion object {
        fun parse(json: String): RelayPairing {
            val value = JSONObject(json)
            require(value.getString("role") == "android")
            val pairId = value.getString("pairId")
            require(UUID.fromString(pairId).toString() == pairId)
            val token = value.getString("token")
            val keyId = value.getString("keyId")
            require(token.matches(Regex("[A-Za-z0-9_-]{43,128}")))
            require(keyId.matches(Regex("[A-Za-z0-9_-]{1,64}")))
            val key = Base64.decode(value.getString("encryptionKey"), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            require(key.size == 32)
            return RelayPairing(pairId, token, keyId, key)
        }
        fun read(context: Context): RelayPairing? = runCatching { parse(SecretStore.read(context)) }.getOrNull()
    }
}
