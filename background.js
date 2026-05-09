const defaultAiSettings = {
  provider: "gemini",
  endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
  model: "gemini-2.5-flash",
  apiKey: ""
};

let cachedGeminiEnvKey = null;

const systemPrompt = [
  "Vous êtes un assistant expert en remplissage de formulaires.",
  "Répondez uniquement avec du JSON valide, sans bloc de code ni explication autour.",
  'Le format attendu est: {"answers":[{"questionId":"","answer":"","confidence":0,"reasoning":""}]} .',
  "Pour les questions radio et select, choisissez une seule valeur parmi options.value.",
  "Pour les checkbox, retournez un tableau de valeurs.",
  "Pour les champs textuels, retournez une réponse courte, plausible et adaptée au libellé.",
  "Conservez exactement questionId.",
  "La confiance doit être un entier entre 0 et 100."
].join(" ");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GENERATE_ANSWERS") {
    handleGenerateAnswers(message)
      .then((payload) => sendResponse(payload))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Erreur inconnue." }));
    return true;
  }

  if (message?.type === "GET_DEFAULT_SETTINGS") {
    sendResponse({ ok: true, settings: defaultAiSettings });
    return false;
  }

  return false;
});

async function handleGenerateAnswers(message) {
  const settings = normalizeSettings(message.settings);
  const form = normalizeFormPayload(message.form);
  const apiKey = settings.provider === "gemini"
    ? await resolveGeminiApiKey(settings.apiKey)
    : settings.apiKey;

  if (!form.questions.length) {
    return { ok: true, mode: "heuristic", answers: [] };
  }

  if (!apiKey) {
    return {
      ok: true,
      mode: "heuristic",
      answers: generateHeuristicAnswers(form.questions)
    };
  }

  try {
    const responseText = await callProvider({ ...settings, apiKey }, form);
    const parsed = parseAiJson(responseText);
    const answers = normalizeAiAnswers(parsed, form.questions);

    return {
      ok: true,
      mode: "api",
      answers
    };
  } catch (error) {
    return {
      ok: true,
      mode: "heuristic",
      answers: generateHeuristicAnswers(form.questions),
      warning: error.message || "Le fournisseur IA a échoué, retour sur le mode local."
    };
  }
}

async function resolveGeminiApiKey(explicitKey) {
  const trimmedKey = String(explicitKey || "").trim();
  if (trimmedKey) {
    return trimmedKey;
  }

  if (cachedGeminiEnvKey !== null) {
    return cachedGeminiEnvKey;
  }

  cachedGeminiEnvKey = await loadGeminiApiKeyFromEnv();
  return cachedGeminiEnvKey;
}

async function loadGeminiApiKeyFromEnv() {
  try {
    const response = await fetch(chrome.runtime.getURL(".env"));

    if (!response.ok) {
      return "";
    }

    const envFile = await response.text();
    const parsedEnv = parseEnvFile(envFile);
    return String(parsedEnv.GEMINI_KEY || parsedEnv.GEMINI_API_KEY || parsedEnv.GOOGLE_AI_STUDIO_KEY || "").trim();
  } catch (error) {
    return "";
  }
}

function parseEnvFile(content) {
  return String(content || "")
    .split(/\r?\n/)
    .reduce((accumulator, line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith("#")) {
        return accumulator;
      }

      const equalsIndex = trimmedLine.indexOf("=");
      if (equalsIndex === -1) {
        return accumulator;
      }

      const key = trimmedLine.slice(0, equalsIndex).replace(/^export\s+/, "").trim();
      let value = trimmedLine.slice(equalsIndex + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      accumulator[key] = value;
      return accumulator;
    }, {});
}

function normalizeSettings(settings = {}) {
  const provider = settings.provider || defaultAiSettings.provider;
  const defaults = provider === "gemini"
    ? { endpoint: defaultAiSettings.endpoint, model: defaultAiSettings.model }
    : provider === "anthropic"
    ? { endpoint: "https://api.anthropic.com/v1/messages", model: "claude-3-7-sonnet-latest" }
    : { endpoint: defaultAiSettings.endpoint, model: defaultAiSettings.model };

  return {
    provider,
    endpoint: settings.endpoint || defaults.endpoint,
    model: settings.model || defaults.model,
    apiKey: settings.apiKey || ""
  };
}

function normalizeFormPayload(form) {
  if (!form || typeof form !== "object") {
    return { questions: [] };
  }

  return {
    url: form.url || "",
    timestamp: form.timestamp || new Date().toISOString(),
    title: form.title || "",
    questions: Array.isArray(form.questions) ? form.questions : []
  };
}

async function callProvider(settings, form) {
  const prompt = [
    "Voici la structure JSON du formulaire:",
    JSON.stringify({ form }, null, 2),
    "Retournez uniquement un JSON valide correspondant au format demandé."
  ].join("\n\n");

  if (settings.provider === "gemini") {
    return callGemini(settings, prompt);
  }

  if (settings.provider === "anthropic") {
    return callAnthropic(settings, prompt);
  }

  return callOpenAiCompatible(settings, prompt);
}

async function callGemini(settings, userPrompt) {
  const requestUrl = new URL(settings.endpoint || defaultAiSettings.endpoint);
  requestUrl.searchParams.set("key", settings.apiKey);

  const response = await fetch(requestUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }]
        }
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });

  const payload = await readJsonResponse(response);
  const text = extractGeminiText(payload);

  if (!text) {
    throw new Error("Réponse Gemini vide.");
  }

  return text;
}

function extractGeminiText(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const parts = candidates[0]?.content?.parts;

  if (Array.isArray(parts)) {
    return parts.map((part) => part?.text || "").join("\n").trim();
  }

  return payload?.text || payload?.output_text || "";
}

async function callOpenAiCompatible(settings, userPrompt) {
  const body = {
    model: settings.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.2
  };

  if (/openai\.com/i.test(settings.endpoint)) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body)
  });

  return handleOpenAiCompatibleResponse(response);
}

async function callAnthropic(settings, userPrompt) {
  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  });

  const payload = await readJsonResponse(response);
  const text = Array.isArray(payload?.content)
    ? payload.content.map((part) => part?.text || "").join("\n")
    : payload?.content || payload?.text || "";

  if (!text) {
    throw new Error("Réponse Anthropic vide.");
  }

  return text;
}

async function handleOpenAiCompatibleResponse(response) {
  const payload = await readJsonResponse(response);

  if (Array.isArray(payload?.choices)) {
    const text = payload.choices[0]?.message?.content || payload.choices[0]?.text || "";
    if (!text) {
      throw new Error("Réponse OpenAI vide.");
    }

    return text;
  }

  if (payload?.output_text) {
    return payload.output_text;
  }

  throw new Error("Réponse IA non reconnue.");
}

async function readJsonResponse(response) {
  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`Erreur API ${response.status}: ${rawText.slice(0, 240)}`);
  }

  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Réponse non JSON: ${rawText.slice(0, 240)}`);
  }
}

function parseAiJson(content) {
  const trimmed = String(content || "").trim();

  if (!trimmed) {
    throw new Error("Réponse IA vide.");
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch (error) {
    const objectStart = candidate.indexOf("{");
    const objectEnd = candidate.lastIndexOf("}");

    if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
      return JSON.parse(candidate.slice(objectStart, objectEnd + 1));
    }

    throw new Error("Impossible de parser le JSON retourné par l'IA.");
  }
}

function normalizeAiAnswers(parsed, questions) {
  const answers = Array.isArray(parsed?.answers) ? parsed.answers : Array.isArray(parsed) ? parsed : [];
  const questionMap = new Map(questions.map((question) => [String(question.id), question]));

  return answers
    .map((answer) => {
      const questionId = String(answer?.questionId || answer?.id || "").trim();
      if (!questionId || !questionMap.has(questionId)) {
        return null;
      }

      const question = questionMap.get(questionId);
      return {
        questionId,
        answer: normalizeAnswerForQuestion(question, answer?.answer),
        confidence: clampConfidence(answer?.confidence),
        reasoning: String(answer?.reasoning || "")
      };
    })
    .filter(Boolean);
}

function normalizeAnswerForQuestion(question, answer) {
  if (question.type === "checkbox") {
    if (Array.isArray(answer)) {
      return answer.map(String);
    }

    if (typeof answer === "string") {
      return answer
        .split(/[\n,;]+/)
        .map((value) => value.trim())
        .filter(Boolean);
    }

    if (answer && typeof answer === "object" && Array.isArray(answer.values)) {
      return answer.values.map(String);
    }

    return [];
  }

  if (answer == null) {
    return "";
  }

  if (typeof answer === "object" && "value" in answer) {
    return answer.value;
  }

  return answer;
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function generateHeuristicAnswers(questions) {
  return questions.map((question) => {
    const text = `${question.text || ""} ${question.description || ""}`.toLowerCase();
    const heuristic = guessHeuristicAnswer(question, text);

    return {
      questionId: question.id,
      answer: heuristic.answer,
      confidence: heuristic.confidence,
      reasoning: heuristic.reasoning
    };
  });
}

function guessHeuristicAnswer(question, text) {
  const questionType = String(question.type || "text");

  if (questionType === "radio" || questionType === "select") {
    return pickSingleChoice(question, text);
  }

  if (questionType === "checkbox") {
    return pickCheckboxChoices(question, text);
  }

  return guessTextAnswer(text, question);
}

function pickSingleChoice(question, text) {
  const options = Array.isArray(question.options) ? question.options : [];
  if (!options.length) {
    return { answer: "", confidence: 20, reasoning: "Aucune option disponible." };
  }

  const optionMatch = options.find((option) => {
    const value = String(option.value || option.label || "").toLowerCase();
    return value && text.includes(value);
  });

  if (optionMatch) {
    return {
      answer: optionMatch.value ?? optionMatch.label ?? "",
      confidence: 84,
      reasoning: "Option trouvée par correspondance textuelle."
    };
  }

  if (/\b(pi|π)\b/.test(text)) {
    const piMatch = options.find((option) => String(option.value || option.label || "").includes("3.1415"));
    if (piMatch) {
      return {
        answer: piMatch.value ?? piMatch.label ?? "",
        confidence: 96,
        reasoning: "La valeur la plus plausible pour Pi a été sélectionnée."
      };
    }
  }

  const firstOption = options[0];
  return {
    answer: firstOption.value ?? firstOption.label ?? "",
    confidence: 44,
    reasoning: "Première option sélectionnée comme solution de repli."
  };
}

function pickCheckboxChoices(question, text) {
  const options = Array.isArray(question.options) ? question.options : [];
  if (!options.length) {
    return { answer: [], confidence: 20, reasoning: "Aucune option disponible." };
  }

  const matches = options.filter((option) => {
    const label = String(option.label || option.value || "").toLowerCase();
    return label && text.includes(label);
  });

  if (matches.length) {
    return {
      answer: matches.map((option) => option.value ?? option.label ?? ""),
      confidence: 76,
      reasoning: "Options sélectionnées par correspondance textuelle."
    };
  }

  return {
    answer: [options[0].value ?? options[0].label ?? ""].filter(Boolean),
    confidence: 40,
    reasoning: "Première option sélectionnée comme solution de repli."
  };
}

function guessTextAnswer(text, question) {
  if (/\b(email|e-mail|courriel)\b/.test(text)) {
    return { answer: "john.doe@example.com", confidence: 90, reasoning: "Le champ demande une adresse e-mail." };
  }

  if (/\b(prénom|first name)\b/.test(text)) {
    return { answer: "Jean", confidence: 88, reasoning: "Le champ demande un prénom." };
  }

  if (/\b(nom complet|full name|name)\b/.test(text)) {
    return { answer: "Jean Dupont", confidence: 86, reasoning: "Le champ demande un nom complet." };
  }

  if (/\b(téléphone|phone|mobile)\b/.test(text)) {
    return { answer: "+33 6 12 34 56 78", confidence: 84, reasoning: "Le champ demande un numéro de téléphone." };
  }

  if (/\b(adresse|address)\b/.test(text)) {
    return { answer: "12 rue de la Paix, 75002 Paris", confidence: 82, reasoning: "Le champ demande une adresse postale." };
  }

  if (/\b(ville|city)\b/.test(text)) {
    return { answer: "Paris", confidence: 80, reasoning: "Le champ demande une ville." };
  }

  if (/\b(pays|country)\b/.test(text)) {
    return { answer: "France", confidence: 80, reasoning: "Le champ demande un pays." };
  }

  if (/\b(code postal|postal code|zip)\b/.test(text)) {
    return { answer: "75002", confidence: 78, reasoning: "Le champ demande un code postal." };
  }

  if (/\b(date)\b/.test(text)) {
    return { answer: new Date().toISOString().slice(0, 10), confidence: 74, reasoning: "Le champ demande une date." };
  }

  if (/\b(time|heure)\b/.test(text)) {
    return { answer: "09:00", confidence: 72, reasoning: "Le champ demande une heure." };
  }

  if (/\b(url|site|website)\b/.test(text)) {
    return { answer: "https://example.com", confidence: 76, reasoning: "Le champ demande une URL." };
  }

  if (/\b(age|âge)\b/.test(text)) {
    return { answer: "30", confidence: 70, reasoning: "Le champ demande un âge." };
  }

  if (/\b(comment|message|remark)\b/.test(text)) {
    return { answer: "Merci, voici ma réponse.", confidence: 66, reasoning: "Le champ demande un commentaire ou un message." };
  }

  const placeholder = question.placeholder || question.text || "";
  return {
    answer: placeholder ? `Réponse proposée pour ${placeholder}` : "Réponse proposée",
    confidence: 42,
    reasoning: "Réponse de repli générée localement."
  };
}