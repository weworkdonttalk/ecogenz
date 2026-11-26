#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <Servo.h>
#include <DHT.h>
#include <ArduinoJson.h>

// ==========================================
// Konfigurasi WiFi & Backend EcoGenZ
// ==========================================
const char* WIFI_SSID = "NAMA_WIFI_ANDA";
const char* WIFI_PASSWORD = "PASSWORD_WIFI_ANDA";
const char* SYNC_URL = "https://ecogenz.vercel.app/api/iot/sync";
const char* IOT_API_KEY = "ISI_IOT_API_KEY_ANDA";

// ==========================================
// Pinout Wemos D1 Mini
// ==========================================
#define TRIG_PIN D5
#define ECHO_PIN D3
#define SERVO_PIN D1
#define DHT_PIN D2
#define MQ2_PIN A0
#define DHT_TYPE DHT11

// ==========================================
// Konstanta Pemilahan & Servo
// ==========================================
const float BATAS_ADA_SAMPAH_CM = 18.0;
const int SERVO_NETRAL = 90;
const int SERVO_ORGANIK = 20;
const int SERVO_ANORGANIK = 160;
const unsigned long DURASI_BUANG_MS = 2500;
const unsigned long SYNC_INTERVAL_MS = 3000;

Servo sorterServo;
DHT dht(DHT_PIN, DHT_TYPE);

bool trashDetected = false;
bool sortDonePending = false;
bool prevTrashDetected = false;
unsigned long lastSyncMs = 0;

float bacaJarakCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) {
    return 999.0;
  }
  return (duration * 0.0343f) / 2.0f;
}

void jalankanServoPilah(const String& sortCommand) {
  int targetAngle = SERVO_NETRAL;

  if (sortCommand == "ORGANIK") {
    targetAngle = SERVO_ORGANIK;
    Serial.println("[SERVO] Memilah ke ORGANIK (20 deg)...");
  } else if (sortCommand == "ANORGANIK") {
    targetAngle = SERVO_ANORGANIK;
    Serial.println("[SERVO] Memilah ke ANORGANIK (160 deg)...");
  } else {
    return;
  }

  sorterServo.write(targetAngle);
  delay(DURASI_BUANG_MS);

  sorterServo.write(SERVO_NETRAL);
  Serial.println("[SERVO] Kembali ke posisi netral (90 deg).");
  delay(450);

  // Verifikasi ulang ultrasonik apakah sampah sudah jatuh dari nampan
  float jarakVerifikasi = bacaJarakCm();
  trashDetected = (jarakVerifikasi > 0.0f && jarakVerifikasi < BATAS_ADA_SAMPAH_CM);

  Serial.print("[ULTRASONIC] Jarak pasca-sortir: ");
  Serial.print(jarakVerifikasi);
  Serial.print(" cm | trashDetected = ");
  Serial.println(trashDetected ? "true" : "false");

  if (!trashDetected) {
    sortDonePending = true;
    Serial.println("[SORT] Sampah terverifikasi jatuh, kirim sort_done=true pada sync berikutnya.");
  } else {
    Serial.println("[SORT] Sampah masih terdeteksi di nampan.");
  }
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("[WIFI] Menghubungkan ke ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WIFI] Terhubung! IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[WIFI] Gagal terhubung, akan coba lagi.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(MQ2_PIN, INPUT);

  dht.begin();
  sorterServo.attach(SERVO_PIN);
  sorterServo.write(SERVO_NETRAL);

  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    delay(1000);
    return;
  }

  unsigned long now = millis();
  if (now - lastSyncMs < SYNC_INTERVAL_MS) {
    return;
  }
  lastSyncMs = now;

  // Baca sensor
  float jarakCm = bacaJarakCm();
  trashDetected = (jarakCm > 0.0f && jarakCm < BATAS_ADA_SAMPAH_CM);
  bool openedNow = (!prevTrashDetected && trashDetected);
  prevTrashDetected = trashDetected;

  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();
  if (isnan(temperature)) temperature = 0.0f;
  if (isnan(humidity)) humidity = 0.0f;

  int gasLevel = analogRead(MQ2_PIN);
  String lidStatus = trashDetected ? "TERISI" : "STANDBY";

  // Siapkan JSON payload sync
  JsonDocument reqDoc;
  reqDoc["temperature"] = temperature;
  reqDoc["humidity"] = humidity;
  reqDoc["gas_level"] = gasLevel;
  reqDoc["distance_cm"] = jarakCm;
  reqDoc["lid_status"] = lidStatus;
  reqDoc["opened_now"] = openedNow;
  reqDoc["trash_detected"] = trashDetected;
  reqDoc["sort_done"] = sortDonePending;

  String requestBody;
  serializeJson(reqDoc, requestBody);

  BearSSL::WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  if (!http.begin(client, SYNC_URL)) {
    Serial.println("[HTTP] Gagal inisialisasi koneksi HTTPS.");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", IOT_API_KEY);

  int httpCode = http.POST(requestBody);
  if (httpCode > 0) {
    String responseBody = http.getString();
    Serial.print("[SYNC] HTTP ");
    Serial.print(httpCode);
    Serial.print(" | ");
    Serial.println(responseBody);

    if (httpCode == HTTP_CODE_OK) {
      // Reset flag sort_done setelah berhasil terkirim ke server
      if (sortDonePending) {
        sortDonePending = false;
      }

      JsonDocument resDoc;
      DeserializationError err = deserializeJson(resDoc, responseBody);
      if (!err) {
        String sortCommand = resDoc["sort_command"] | "NONE";
        if (sortCommand == "ORGANIK" || sortCommand == "ANORGANIK") {
          jalankanServoPilah(sortCommand);
        }
      } else {
        Serial.print("[JSON] Parse error: ");
        Serial.println(err.c_str());
      }
    }
  } else {
    Serial.print("[HTTP] POST gagal: ");
    Serial.println(http.errorToString(httpCode));
  }

  http.end();
}
