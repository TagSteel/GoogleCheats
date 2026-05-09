# Google Cheats

[![GitHub Release](https://img.shields.io/github/v/release/TagSteel/GoogleCheats?display_name=release)](https://github.com/TagSteel/GoogleCheats/releases/latest)
[![Platform](https://img.shields.io/badge/Platform-Chromium-lightgrey)](https://github.com/TagSteel/ChromeRecover)

Google Cheats is a browser extension that analyzes Google Forms and automatically generates editable answers using AI.

The extension extracts form fields and questions from Google Forms pages, reconstructs them, and provides intelligent suggestions powered by Gemini 2.5 Flash or other AI providers.

## Features

- Automatic form field detection
- Question reconstruction and analysis
- AI-powered answer generation (Gemini, OpenAI, Anthropic)
- Editable answer suggestions
- Multiple AI provider support
- Local fallback mode with heuristics
- JSON export functionality
- Persistent data storage
- Custom API configuration
- Support for multiple input types (text, textarea, select, radio, checkbox)


## Installation

### 1. Clone the repository

```bash
git clone https://github.com/TagSteel/GoogleCheats.git
```

Or [download](https://github.com/TagSteel/GoogleCheats/archive/refs/heads/main.zip) the ZIP manually.

---

### 2. Load the extension

1. Open your browser
2. Go to the extension page ([Chrome](chrome://extensions) / [Edge](edge://extensions/) / [Opera](opera://extensions) / ...)
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the extension folder


## How it works

The extension works in three main steps:

### 1. Form Detection

The extension scans Google Forms pages and extracts all form fields, including:
- Question text and types
- Required/optional status
- Available options (for select, radio, checkbox)
- Helper text and descriptions

### 2. Answer Generation

Answers can be generated in two modes:

- **API Mode**: Uses Gemini 2.5 Flash, OpenAI, or Anthropic API
- **Heuristic Mode**: Falls back to local rule-based generation if no API key is available

Generated answers include:
- Answer content
- Confidence score
- Reasoning/evidence

### 3. Storage & Export

Answers are:
- Editable in the popup interface
- Stored locally using `chrome.storage.local`
- Exportable as JSON format


## Configuration

The extension supports multiple AI providers:

- **Gemini** (default): Google AI Studio or custom endpoint
- **OpenAI**: Compatible with OpenAI API
- **Anthropic**: Claude API support

### Setting up an API key

1. Open the extension popup
2. Go to **Configuration Gemini**
3. Select your provider
4. Enter your API key
5. Click **Save configuration**

Alternatively, create a `.env` file in the extension directory:

```env
GEMINI_KEY=your_api_key_here
```


## Technologies

- [JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
- [Chrome Extensions Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Google Generative AI API](https://ai.google.dev/)
- [OpenAI API](https://openai.com/api/)
- [Anthropic API](https://www.anthropic.com/)


## Disclaimer

This project is not affiliated with or endorsed by Google or any AI provider.

This extension was created for experimental purposes only.

Please respect the terms of service of Google Forms and the AI services you use.

**Use responsibly**: Do not use this tool for academic dishonesty or to violate institutional policies.
