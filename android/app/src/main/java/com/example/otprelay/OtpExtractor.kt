package com.example.otprelay

import java.util.Locale

/** Conservative sender-approved extraction. Never log the message or extracted token. */
object OtpExtractor {
    private val explicitPrefix = Regex("\\bOTP[ \\t]+is[ \\t]+", RegexOption.IGNORE_CASE)
    private val keyword = Regex("\\b(otp|verification|verify|passcode|security|login|sign.in|code)\\b", RegexOption.IGNORE_CASE)
    private val numeric = Regex("(?<![A-Za-z0-9_+/=])[0-9]{4,8}(?![A-Za-z0-9_+/=])")
    private val appHashLine = Regex("[A-Za-z0-9+/]{11}")

    fun extractApproved(sender: String?, approvedSenders: Collection<String>, message: String): String? {
        val normalized = sender?.trim()?.lowercase(Locale.ROOT) ?: return null
        if (normalized.isEmpty() || approvedSenders.none {
                it.trim().isNotEmpty() && it.trim().lowercase(Locale.ROOT) == normalized
            }) return null
        return extract(message)
    }

    /** When no sender filter is configured, relay the complete SMS body. */
    fun extractForRelay(sender: String?, approvedSenders: Collection<String>, message: String): String? {
        if (approvedSenders.isEmpty()) {
            val body = message.trim()
            return body.takeIf { it.isNotEmpty() && it.toByteArray(Charsets.UTF_8).size <= 1024 }
        }
        return extractApproved(sender, approvedSenders, message)
    }

    fun extract(message: String): String? {
        // SMS Retriever app hashes are 11 base64 characters on a separate trailing line.
        // Never use a bare alphanumeric search: it can mistake the app hash for the OTP.
        val text = message.lineSequence().filterNot { appHashLine.matches(it.trim()) }.joinToString("\n")
        val prefixes = explicitPrefix.findAll(text).toList()
        if (prefixes.isNotEmpty()) {
            if (prefixes.size != 1) return null // ambiguous messages require a service-specific parser
            val token = text.substring(prefixes.single().range.last + 1)
                .takeWhile { !it.isWhitespace() }.trimEnd('.', ',', ';', ':', '!', '?')
            // 4–10 characters covers Easypaisa. Eleven-character app hashes are never OTPs here.
            return token.takeIf { it.matches(Regex("[A-Za-z0-9]{4,10}")) && it.any { c -> c in '0'..'9' } }
        }
        if (!keyword.containsMatchIn(text)) return null
        // Conservative compatibility for existing numeric SMS formats; reject ambiguity.
        val candidates = numeric.findAll(text).map { it.value }.toList()
        return candidates.singleOrNull()
    }
}
