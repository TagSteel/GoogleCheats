# Google Cheats

[![GitHub Release](https://img.shields.io/github/v/release/TagSteel/GoogleCheats?display_name=release)](https://github.com/TagSteel/GoogleCheats/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Chromium-lightgrey)](https://github.com/TagSteel/ChromeRecover)

Google Cheats is a browser extension that analyzes Google Forms and automatically generates editable answers using AI.

It extracts form fields and questions from Google Forms pages, reconstructs them, and provides intelligent suggestions powered by Gemini 2.5 Flash, Gemma 3 27B, GPT 5 mini, or Claude Sonnet 3.7.

## Features

- Automatic form field detection
- Question reconstruction and analysis
- AI-powered answer generation for Gemini 2.5 Flash, Gemma 3 27B, OpenAI, and Anthropic
- Editable answer suggestions
- Local fallback mode with heuristics
- JSON export functionality
- Persistent data storage
- Custom API configuration
- Support for multiple input types: text, textarea, select, radio, checkbox

## Installation

- Clone the repository:

```bash
git clone https://github.com/TagSteel/GoogleCheats.git
```

Or [download](https://github.com/TagSteel/GoogleCheats/archive/refs/heads/main.zip) the ZIP manually.

- Load the extension:

1. Open your browser
2. Go to the extension page in Chrome, Edge, or another Chromium-based browser
3. Enable Developer mode
4. Click Load unpacked
5. Select the extension folder

## How it works

The extension works in three steps:

1. Form detection: it scans Google Forms pages and extracts the questions, required state, available options, helper text, and descriptions.
2. Answer generation: it can call the selected provider API or fall back to local heuristic generation when no key is available.
3. Storage and export: generated answers remain editable in the popup, are stored locally, and can be exported as JSON.

## Configuration

The extension supports multiple AI providers:

- Gemini 2.5 Flash: Google AI Studio
- Gemma 3 27B: Google AI Studio
- GPT 5 mini: OpenAI
- Claude Sonnet 3.7: Anthropic

To configure an API key:

1. Open the extension popup
2. Go to Configuration IA
3. Select your provider
4. Enter your API_KEY
5. Click `Save configuration`.

Alternatively, create a `.env` file in the extension directory:

```env
API_KEY=your_api_key_here
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

Use responsibly: do not use this tool for academic dishonesty or to violate institutional policies.
