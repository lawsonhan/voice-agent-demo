# 專案結構與原理（教學版）

這個專案是一個「錄音 → 廣東話 STT → LLM 回覆 → TTS 播放」的最小可行 Voice Agent。

設計目標：

- 只要求 Chrome
- 允許「錄完先識別」（非流式）
- 學生電腦不需要額外安裝系統軟件（例如 ffmpeg）
- STT 必須支援廣東話（由 Cantonese AI STT 提供）

## 檔案結構

```text
voice-agent-demo/
├── index.html            # UI 結構
├── style.css             # 眼睛動畫 + 狀態顏色
├── wav-recorder.js       # 瀏覽器錄音 + 產生 WAV（核心：無需 ffmpeg）
├── script.js             # 狀態機 + 呼叫後端 API + 播放 TTS
├── README.md             # 快速使用
├── .env.example          # 環境變數範本（唔包含真 key）
├── .env                  # 本機環境變數（已被 .gitignore 忽略）
└── backend/
    ├── main.py           # FastAPI：/stt /chat /tts
    ├── services.py       # 封裝 Poe + Cantonese AI 的 API 呼叫
    └── requirements.txt  # Python 依賴
```

## 整體流程

1. 使用者點擊畫面（robot face）開始錄音。
2. 前端用 WebAudio 擷取麥克風 PCM 音訊，並在瀏覽器內編碼成 `audio/wav`。
3. 前端把 `wav` 以 `multipart/form-data` 上傳到後端 `/stt`。
4. 後端把音訊送到 Cantonese AI STT，取回文字（支援廣東話）。
5. 後端把文字送到 Poe LLM，取得 AI 回覆。
6. 後端把回覆送到 Cantonese AI TTS，取得音訊 bytes。
7. 前端播放後端回傳的音訊。

## 前端（index.html / script.js / wav-recorder.js）

### UI 狀態機（script.js）

`script.js` 用一個簡單狀態機控制 UI：

- `idle`：待機
- `listening`：錄音中
- `processing`：STT / LLM / TTS 處理中
- `speaking`：播放中

目標是令學生可以清楚看到每個階段在做甚麼。

### 錄音與靜音停止（wav-recorder.js）

`wav-recorder.js` 用 WebAudio 收音：

- 透過 `navigator.mediaDevices.getUserMedia({ audio: true })` 取得麥克風 stream
- 透過 `AudioContext` + `ScriptProcessorNode` 取得 PCM samples
- 以 RMS 閾值做靜音偵測：有聲就更新最後說話時間；連續靜音超過指定時間就觸發 `onSilence()`，令 `script.js` 自動停止錄音
- `stop()` 時把 PCM resample 到 16kHz，再編碼成 16-bit PCM WAV

為甚麼要「瀏覽器內產 WAV」：

- Chrome 的 `MediaRecorder` 通常會產生 `audio/webm`
- STT 服務未必接受 `webm`
- 教學環境不允許學生額外安裝轉碼軟件

所以最穩妥是直接產生 STT 友善格式（WAV）。

備註：`ScriptProcessorNode` 是較舊 API，較新的做法是 `AudioWorklet`。

## 後端（backend/main.py / backend/services.py）

### API 介面（backend/main.py）

- `POST /stt`
  - 輸入：`multipart/form-data`，欄位名 `audio`
  - 輸出：`{ "text": "..." }`
- `POST /chat`
  - 輸入：`{ "message": "..." }`
  - 輸出：`{ "reply": "..." }`
- `POST /tts`
  - 輸入：`{ "text": "..." }`
  - 輸出：音訊串流（`audio/mpeg` 或 `audio/wav`）

後端會自動載入根目錄 `.env`（`python-dotenv`），方便教學時不需要每次手動 export。

### 上游整合（backend/services.py）

`services.py` 將所有外部 API 呼叫集中：

- `query_poe()`
- `transcribe_audio()`
- `synthesize_speech()`

好處：

- `main.py` 保持「路由 + 入參檢查 + 回應」的簡單角色
- 需要更換 API 供應商時，主要改 `services.py`

## 環境變數（.env）

必要：

- `CANTONESE_API_KEY`
- `POE_API_KEY`

可選：

- `POE_MODEL`（預設 `gpt-4o`）
- `CANTONESE_TTS_VOICE_ID`
- `CANTONESE_TTS_OUTPUT`（`mp3` / `wav`）
- `CANTONESE_TTS_LANGUAGE`
- `CANTONESE_TTS_FRAME_RATE`
- `CANTONESE_TTS_SPEED`

## 常見錯誤

- 502 Bad Gateway：代表後端呼叫上游（STT/LLM/TTS）失敗。查看回傳 JSON 的 `detail`，通常會寫明是 missing key、401，或上游錯誤。
- 無法錄音：確認用 `http://localhost` 打開，並確認 Chrome 已允許麥克風權限。
