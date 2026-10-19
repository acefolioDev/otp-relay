plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "com.example.otprelay"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.acefolio.otprelay"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "RELAY_BASE_URL", "\"https://otp-relay-production-a3b3.up.railway.app\"")
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildFeatures { buildConfig = true }
    buildTypes { getByName("release") { isMinifyEnabled = false } }
}
dependencies { testImplementation("junit:junit:4.13.2") }

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
