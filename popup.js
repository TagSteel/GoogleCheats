const defaultSettings = {
	provider: "gemini",
	endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
	model: "gemini-2.5-flash",
	apiKey: ""
};

const providerDefaults = {
	gemini: {
		endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
		model: "gemini-2.5-flash"
	},
	openai: {
		endpoint: "https://api.openai.com/v1/chat/completions",
		model: "gpt-4.1-mini"
	},
	anthropic: {
		endpoint: "https://api.anthropic.com/v1/messages",
		model: "claude-3-7-sonnet-latest"
	}
};

const state = {
	formData: null,
	suggestions: [],
	history: [],
	currentFormSignature: "",
	currentHistoryEntryId: "",
	settings: { ...defaultSettings }
};

const editorNodes = new Map();

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
	initializePopup();
	initializeFooter();
});

async function initializePopup() {
	cacheElements();
	bindEvents();
	await loadSettings();
	await loadPersistedData();
	updateSettingsPanelState();
	setStatus("Prêt à analyser la page active.");
}

function cacheElements() {
	elements.analyzeButton = document.getElementById("analyze-button");
	elements.generateButton = document.getElementById("generate-button");
	elements.copyButton = document.getElementById("copy-button");
	elements.resetButton = document.getElementById("reset-button");
	elements.statusPill = document.getElementById("status-pill");
	elements.loader = document.getElementById("loader");
	elements.formSummary = document.getElementById("form-summary");
	elements.answersList = document.getElementById("answers-list");
	elements.historyList = document.getElementById("history-list");
	elements.providerSelect = document.getElementById("provider-select");
	elements.endpointInput = document.getElementById("endpoint-input");
	elements.modelInput = document.getElementById("model-input");
	elements.apiKeyInput = document.getElementById("api-key-input");
	elements.saveSettingsButton = document.getElementById("save-settings-button");
	elements.settingsPanel = document.getElementById("settings-panel");
	elements.authorsContainer = document.getElementById("authors-container");
}

function bindEvents() {
	elements.analyzeButton.addEventListener("click", handleAnalyzeClick);
	elements.generateButton.addEventListener("click", handleGenerateClick);
	elements.copyButton.addEventListener("click", handleCopyClick);
	elements.resetButton.addEventListener("click", handleResetClick);
	elements.saveSettingsButton.addEventListener("click", handleSaveSettingsClick);
	elements.providerSelect.addEventListener("change", handleProviderChange);
	elements.historyList.addEventListener("click", handleHistoryClick);
}

async function handleAnalyzeClick() {
	setBusy(true, "Analyse du formulaire...");
	try {
		const response = await requestFormDataFromActiveTab();
		if (response?.error || response?.ok === false) {
			throw new Error(response.error || "Impossible d'analyser le formulaire.");
		}

		const formData = response?.form ? response : { form: response };
		const formPayload = formData?.form || formData || null;
		const formSignature = getFormSignature(formPayload);
		const cachedHistoryEntry = findHistoryEntryBySignature(formSignature);
		state.formData = formData;
		state.currentFormSignature = formSignature;
		state.suggestions = cachedHistoryEntry?.suggestions || [];
		state.currentHistoryEntryId = "";
		const historyEntry = await appendHistoryEntry(formData, formSignature, state.suggestions);
		state.currentHistoryEntryId = historyEntry.id;
		await persistData();
		renderFormSummary(getFormPayload().questions || []);
		renderAnswers(state.suggestions);
		renderHistory();
		elements.generateButton.disabled = !(getFormPayload().questions || []).length;
		elements.copyButton.disabled = state.suggestions.length === 0;
		setStatus(
			state.suggestions.length
				? "Formulaire reconnu, réponses chargées depuis l'historique."
				: `${(getFormPayload().questions || []).length} question(s) détectée(s).`,
			"success"
		);
	} catch (error) {
		setStatus(error.message || "Impossible d'analyser le formulaire.", "error");
		renderFormSummary([]);
		renderAnswers([]);
		elements.generateButton.disabled = true;
		elements.copyButton.disabled = true;
	} finally {
		setBusy(false);
	}
}

async function handleGenerateClick() {
	if (!state.formData) {
		await handleAnalyzeClick();
	}

	const formPayload = getFormPayload();
	if (!formPayload?.questions?.length) {
		setStatus("Aucune question détectée sur cette page.", "error");
		return;
	}

	const formSignature = getFormSignature(formPayload);
	const cachedHistoryEntry = findHistoryEntryBySignature(formSignature);
	if (cachedHistoryEntry?.suggestions?.length) {
		state.currentFormSignature = formSignature;
		state.suggestions = cachedHistoryEntry.suggestions;
		renderAnswers(state.suggestions);
		elements.copyButton.disabled = state.suggestions.length === 0;
		setStatus("Réponses récupérées depuis l'historique.", "success");
		return;
	}

	const currentSettings = collectSettingsFromForm();
	state.settings = currentSettings;

	setBusy(true, "Envoi à l'IA...");
	try {
		const response = await sendRuntimeMessage({
			type: "GENERATE_ANSWERS",
			form: formPayload,
			settings: currentSettings
		});

		if (!response?.ok) {
			throw new Error(response?.error || "Réponse IA indisponible.");
		}

		state.suggestions = Array.isArray(response.answers) ? response.answers : [];
		await updateCurrentHistoryEntrySuggestions(state.suggestions);
		await persistData();
		renderAnswers(state.suggestions);
		elements.copyButton.disabled = state.suggestions.length === 0;
		setStatus(
			response.mode === "heuristic"
				? "Réponses générées localement."
				: "Réponses proposées par l'IA.",
			"success"
		);
	} catch (error) {
		setStatus(error.message || "Impossible de générer les réponses.", "error");
	} finally {
		setBusy(false);
	}
}

async function handleCopyClick() {
	const answers = collectEditedAnswers();
	const payload = JSON.stringify({ answers }, null, 2);

	try {
		await navigator.clipboard.writeText(payload);
		setStatus("JSON copié dans le presse-papiers.", "success");
	} catch (error) {
		setStatus("Impossible de copier le JSON.", "error");
	}
}

async function handleResetClick() {
	state.formData = null;
	state.suggestions = [];
	state.currentFormSignature = "";
	state.currentHistoryEntryId = "";
	editorNodes.clear();
	await chrome.storage.local.remove("formAnalyzerData");
	renderFormSummary([]);
	renderAnswers([]);
	elements.generateButton.disabled = true;
	elements.copyButton.disabled = true;
	setStatus("Dernier formulaire réinitialisé.", "success");
}

async function handleSaveSettingsClick() {
	const settings = collectSettingsFromForm();
	state.settings = settings;
	await chrome.storage.local.set({ formAnalyzerSettings: settings });
	updateSettingsPanelState();
	setStatus("Configuration enregistrée.", "success");
}

function handleProviderChange() {
	const provider = elements.providerSelect.value;
	const defaults = providerDefaults[provider] || providerDefaults.gemini;

	elements.endpointInput.value = defaults.endpoint;
	elements.modelInput.value = defaults.model;
}

async function loadSettings() {
	const stored = await chrome.storage.local.get("formAnalyzerSettings");
	state.settings = { ...defaultSettings, ...(stored.formAnalyzerSettings || {}) };
	applySettingsToForm(state.settings);
}

async function loadPersistedData() {
	const stored = await chrome.storage.local.get(["formAnalyzerData", "formAnalyzerHistory"]);
	state.history = Array.isArray(stored.formAnalyzerHistory) ? stored.formAnalyzerHistory : [];
	renderHistory();
	if (stored.formAnalyzerData) {
		state.formData = stored.formAnalyzerData.formData || null;
		state.suggestions = stored.formAnalyzerData.suggestions || [];
		if (state.formData) {
			state.currentFormSignature = getFormSignature(getFormPayload());
			renderCurrentAnalysis();
			return;
		}
	}
	renderCurrentAnalysis();
}

async function persistData() {
	await chrome.storage.local.set({
		formAnalyzerData: {
			formData: state.formData,
			suggestions: state.suggestions
		}
	});
}

async function appendHistoryEntry(formData, formSignature, suggestions = []) {
	const entry = {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		analyzedAt: new Date().toISOString(),
		formSignature,
		suggestions,
		formData
	};

	state.history = [entry, ...state.history];
	await chrome.storage.local.set({ formAnalyzerHistory: state.history });
	return entry;
}

async function updateCurrentHistoryEntrySuggestions(suggestions) {
	if (!state.currentHistoryEntryId) {
		return;
	}

	const entry = state.history.find((item) => item.id === state.currentHistoryEntryId);
	if (!entry) {
		return;
	}

	entry.suggestions = suggestions;
	await chrome.storage.local.set({ formAnalyzerHistory: state.history });
}

function renderCurrentAnalysis() {
	const questions = getFormPayload()?.questions || [];
	renderFormSummary(questions);
	renderAnswers(state.suggestions);
	elements.generateButton.disabled = !questions.length;
	elements.copyButton.disabled = state.suggestions.length === 0;
}

function renderHistory() {
	const historyEntries = Array.isArray(state.history) ? [...state.history].sort((left, right) => {
		return new Date(right.analyzedAt || 0).getTime() - new Date(left.analyzedAt || 0).getTime();
	}) : [];
	elements.historyList.innerHTML = "";

	if (!historyEntries.length) {
		const emptyState = document.createElement("p");
		emptyState.className = "empty-state";
		emptyState.textContent = "Aucun formulaire analysé pour le moment.";
		elements.historyList.appendChild(emptyState);
		return;
	}

	let currentDayKey = "";
	let currentDayContainer = null;
	let currentDayCount = 0;

	historyEntries.forEach((entry) => {
		const analyzedAt = entry.analyzedAt ? new Date(entry.analyzedAt) : new Date();
		const dayKey = getHistoryDayKey(analyzedAt);

		if (dayKey !== currentDayKey) {
			currentDayContainer = createHistoryDayGroup(analyzedAt);
			elements.historyList.appendChild(currentDayContainer);
			currentDayKey = dayKey;
			currentDayCount = 0;
		}

		currentDayCount += 1;
		currentDayContainer.querySelector(".history-day-count").textContent = `${currentDayCount} analyse(s)`;
		currentDayContainer.querySelector(".history-day-items").appendChild(createHistoryItem(entry, analyzedAt));
	});
}

function createHistoryDayGroup(date) {
	const wrapper = document.createElement("article");
	wrapper.className = "history-day";

	const header = document.createElement("div");
	header.className = "history-day-header";

	const title = document.createElement("strong");
	title.textContent = formatHistoryDayLabel(date);

	const count = document.createElement("span");
	count.className = "history-day-count";
	count.textContent = "";

	const items = document.createElement("div");
	items.className = "history-day-items";

	header.append(title, count);
	wrapper.append(header, items);
	return wrapper;
}

function createHistoryItem(entry, analyzedAt) {
	const article = document.createElement("article");
	article.className = "history-item";
	article.dataset.historyId = entry.id || "";

	const title = document.createElement("p");
	title.className = "history-item-title";
	title.textContent = getHistoryTitle(entry.formData);

	const meta = document.createElement("div");
	meta.className = "history-item-meta";
	meta.textContent = `${formatHistoryTime(analyzedAt)} · ${getHistoryQuestionCount(entry.formData)} question(s)`;

	const url = document.createElement("p");
	url.className = "history-item-url";
	url.textContent = getHistoryUrl(entry.formData);

	const button = document.createElement("button");
	button.type = "button";
	button.className = "history-load-button";
	button.dataset.historyId = entry.id || "";
	button.textContent = "Charger";

	article.append(title, meta, url, button);
	return article;
}

async function handleHistoryClick(event) {
	const button = event.target.closest("button[data-history-id]");
	if (!button) {
		return;
	}

	const entry = state.history.find((item) => item.id === button.dataset.historyId);
	if (!entry) {
		return;
	}

	state.formData = entry.formData || null;
	state.currentFormSignature = entry.formSignature || getFormSignature(getFormPayload());
	state.suggestions = Array.isArray(entry.suggestions) ? entry.suggestions : [];
	state.currentHistoryEntryId = entry.id || "";
	await persistData();
	renderCurrentAnalysis();
	setStatus("Formulaire chargé depuis l'historique.", "success");
}

function findHistoryEntryBySignature(signature) {
	if (!signature) {
		return null;
	}

	return [...state.history]
		.sort((left, right) => new Date(right.analyzedAt || 0).getTime() - new Date(left.analyzedAt || 0).getTime())
		.find((entry) => entry.formSignature === signature && Array.isArray(entry.suggestions) && entry.suggestions.length > 0) || null;
}

function getFormSignature(formPayload) {
	if (!formPayload) {
		return "";
	}

	const questions = Array.isArray(formPayload.questions) ? formPayload.questions : [];
	const normalizedQuestions = questions.map((question) => {
		const options = Array.isArray(question.options)
			? question.options.map((option) => normalizeSignatureText(option?.label || option?.value || "")).join("|")
			: "";

		return [
			normalizeSignatureText(question.id || ""),
			normalizeSignatureText(question.type || ""),
			normalizeSignatureText(question.text || question.questionCandidate || ""),
			normalizeSignatureText(question.placeholder || ""),
			normalizeSignatureText(question.required ? "required" : "optional"),
			options
		].join("::");
	});

	return [
		normalizeSignatureText(formPayload.url || ""),
		normalizeSignatureText(formPayload.title || ""),
		String(questions.length),
		normalizedQuestions.join("||")
	].join("###");
}

function normalizeSignatureText(value) {
	return String(value || "")
		.normalize("NFKC")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

function getHistoryDayKey(date) {
	return new Intl.DateTimeFormat("en-CA", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	}).format(date);
}

function formatHistoryDayLabel(date) {
	return new Intl.DateTimeFormat("fr-FR", {
		weekday: "long",
		day: "2-digit",
		month: "long",
		year: "numeric"
	}).format(date);
}

function formatHistoryTime(date) {
	return new Intl.DateTimeFormat("fr-FR", {
		hour: "2-digit",
		minute: "2-digit"
	}).format(date);
}

function getHistoryTitle(formData) {
	const formPayload = formData?.form || formData || {};
	return formPayload.title || formPayload.name || formPayload.url || "Formulaire sans titre";
}

function getHistoryUrl(formData) {
	const formPayload = formData?.form || formData || {};
	return formPayload.url || "URL inconnue";
}

function getHistoryQuestionCount(formData) {
	const formPayload = formData?.form || formData || {};
	return Array.isArray(formPayload.questions) ? formPayload.questions.length : 0;
}

function updateSettingsPanelState() {
	const hasApiKey = state.settings?.apiKey?.trim();
	if (elements.settingsPanel) {
		elements.settingsPanel.open = !hasApiKey;
	}
}

function applySettingsToForm(settings) {
	const provider = settings.provider || defaultSettings.provider;
	const defaults = providerDefaults[provider] || providerDefaults.gemini;
	elements.providerSelect.value = provider;
	elements.endpointInput.value = settings.endpoint || defaults.endpoint;
	elements.modelInput.value = settings.model || defaults.model;
	elements.apiKeyInput.value = settings.apiKey || "";
}

function collectSettingsFromForm() {
	const provider = elements.providerSelect.value || defaultSettings.provider;
	const defaults = providerDefaults[provider] || providerDefaults.gemini;

	return {
		provider,
		endpoint: elements.endpointInput.value.trim() || defaults.endpoint,
		model: elements.modelInput.value.trim() || defaults.model,
		apiKey: elements.apiKeyInput.value.trim()
	};
}

function getFormPayload() {
	return state.formData?.form || state.formData || null;
}

function setBusy(isBusy, message) {
	elements.loader.classList.toggle("visible", Boolean(isBusy));
	elements.analyzeButton.disabled = Boolean(isBusy);
	elements.generateButton.disabled = Boolean(isBusy) || !(getFormPayload()?.questions || []).length;
	elements.saveSettingsButton.disabled = Boolean(isBusy);
	if (message) {
		setStatus(message);
	}
}

function setStatus(message, variant = "info") {
	elements.statusPill.textContent = message;
	elements.statusPill.dataset.variant = variant === "info" ? "" : variant;
}

function renderFormSummary(questions) {
	const formPayload = getFormPayload();
	const questionCount = Array.isArray(questions) ? questions.length : 0;
	const typeCounts = questions.reduce((counts, question) => {
		const key = question.type || "unknown";
		counts[key] = (counts[key] || 0) + 1;
		return counts;
	}, {});

	elements.formSummary.innerHTML = "";

	if (!questionCount) {
		const emptyState = document.createElement("p");
		emptyState.className = "empty-state";
		emptyState.textContent = "Aucune question détectée pour cette page.";
		elements.formSummary.appendChild(emptyState);
		return;
	}

	elements.formSummary.appendChild(createSummaryItem("URL", formPayload?.url || "Inconnue"));
	elements.formSummary.appendChild(createSummaryItem("Questions", `${questionCount} élément(s)`));
	elements.formSummary.appendChild(createSummaryItem("Types", Object.entries(typeCounts).map(([key, value]) => `${key}: ${value}`).join(" · ")));
	elements.formSummary.appendChild(createSummaryItem("Horodatage", formPayload?.timestamp || "Non renseigné"));
}

function createSummaryItem(label, value) {
	const article = document.createElement("article");
	article.className = "summary-item";

	const title = document.createElement("strong");
	title.textContent = label;

	const text = document.createElement("span");
	text.textContent = value || "—";

	article.append(title, text);
	return article;
}

function renderAnswers(answers) {
	const questions = getFormPayload()?.questions || [];
	const answerMap = new Map((answers || []).map((answer) => [answer.questionId, answer]));

	elements.answersList.innerHTML = "";
	editorNodes.clear();

	if (!questions.length) {
		const emptyState = document.createElement("p");
		emptyState.className = "empty-state";
		emptyState.textContent = "Lancez d'abord une analyse du formulaire.";
		elements.answersList.appendChild(emptyState);
		return;
	}

	questions.forEach((question) => {
		const answer = answerMap.get(question.id) || {
			questionId: question.id,
			answer: question.type === "checkbox" ? [] : "",
			confidence: question.confidence || 0,
			reasoning: question.evidence ? question.evidence.join(" · ") : ""
		};

		const card = createAnswerCard(question, answer);
		elements.answersList.appendChild(card);
	});
}

function createAnswerCard(question, answer) {
	const card = document.createElement("article");
	card.className = "answer-card";

	const header = document.createElement("div");
	header.className = "answer-header";

	const content = document.createElement("div");

	const title = document.createElement("p");
	title.className = "answer-title";
	title.textContent = question.text || question.questionCandidate || "Question non identifiée";

	const meta = document.createElement("div");
	meta.className = "meta";
	meta.textContent = `Confiance ${formatConfidence(answer.confidence)} · ${question.required ? "obligatoire" : "facultatif"}`;

	const typeChip = document.createElement("span");
	typeChip.className = "type-chip";
	typeChip.textContent = question.type || "unknown";

	content.append(title, meta);
	header.append(content, typeChip);

	const editor = createAnswerEditor(question, answer);
	editorNodes.set(question.id, editor);

	const helper = document.createElement("p");
	helper.className = "helper";
	helper.textContent = answer.reasoning || question.description || question.helperText || "";

	card.append(header, editor);

	if (helper.textContent) {
		card.append(helper);
	}

	return card;
}

function createAnswerEditor(question, answer) {
	const wrapper = document.createElement("div");
	wrapper.className = "answer-editor";

	const normalizedAnswer = normalizeAnswerForEditor(question, answer?.answer);

	if (question.type === "radio" || question.type === "select") {
		const select = document.createElement("select");
		select.dataset.questionId = question.id;
		populateChoiceOptions(select, question.options || [], normalizedAnswer, false);
		wrapper.appendChild(select);
		return wrapper;
	}

	if (question.type === "checkbox") {
		const select = document.createElement("select");
		select.dataset.questionId = question.id;
		select.multiple = true;
		select.size = Math.max(3, Math.min(6, (question.options || []).length + 1));
		populateChoiceOptions(select, question.options || [], normalizedAnswer, true);
		wrapper.appendChild(select);
		return wrapper;
	}

	if (question.type === "textarea" || question.multiline) {
		const textarea = document.createElement("textarea");
		textarea.dataset.questionId = question.id;
		textarea.value = typeof normalizedAnswer === "string" ? normalizedAnswer : String(normalizedAnswer || "");
		wrapper.appendChild(textarea);
		return wrapper;
	}

	const input = document.createElement("input");
	input.type = "text";
	input.dataset.questionId = question.id;
	input.value = typeof normalizedAnswer === "string" || typeof normalizedAnswer === "number" ? String(normalizedAnswer) : "";
	wrapper.appendChild(input);
	return wrapper;
}

function populateChoiceOptions(select, options, answer, allowMultiple) {
	const normalizedAnswer = allowMultiple ? new Set(Array.isArray(answer) ? answer.map(String) : []) : String(answer || "");

	const placeholder = document.createElement("option");
	placeholder.value = "";
	placeholder.textContent = allowMultiple ? "Sélectionner une ou plusieurs valeurs" : "Choisir une option";
	if (!allowMultiple) {
		select.appendChild(placeholder);
	}

	const values = new Set();

	options.forEach((option) => {
		const optionValue = option?.value != null ? String(option.value) : String(option?.label || "");
		const optionLabel = option?.label != null ? String(option.label) : optionValue;
		const optionNode = document.createElement("option");
		optionNode.value = optionValue;
		optionNode.textContent = optionLabel || optionValue;
		if (allowMultiple) {
			optionNode.selected = normalizedAnswer.has(optionValue) || normalizedAnswer.has(optionLabel);
		} else if (normalizedAnswer && (normalizedAnswer === optionValue || normalizedAnswer === optionLabel)) {
			optionNode.selected = true;
		}
		values.add(optionValue);
		select.appendChild(optionNode);
	});

	if (!allowMultiple && normalizedAnswer && !values.has(normalizedAnswer)) {
		const custom = document.createElement("option");
		custom.value = normalizedAnswer;
		custom.textContent = normalizedAnswer;
		custom.selected = true;
		select.appendChild(custom);
	}

	if (allowMultiple) {
		Array.from(select.options).forEach((optionNode) => {
			optionNode.selected = normalizedAnswer.has(optionNode.value) || normalizedAnswer.has(optionNode.textContent);
		});
	}
}

function normalizeAnswerForEditor(question, answer) {
	if (question.type === "checkbox") {
		if (Array.isArray(answer)) {
			return answer.map(String).filter(Boolean);
		}

		if (typeof answer === "string") {
			return answer
				.split(/[\n,;]+/)
				.map((value) => value.trim())
				.filter(Boolean);
		}

		if (answer && typeof answer === "object" && Array.isArray(answer.values)) {
			return answer.values.map(String).filter(Boolean);
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

function collectEditedAnswers() {
	const questions = getFormPayload()?.questions || [];

	return questions.map((question) => {
		const editor = editorNodes.get(question.id);
		const control = editor ? editor.querySelector("input, select, textarea") : null;
		const answer = readEditorValue(question, control);
		const original = state.suggestions.find((item) => item.questionId === question.id) || {};

		return {
			questionId: question.id,
			answer,
			confidence: original.confidence ?? question.confidence ?? 0,
			reasoning: original.reasoning || question.description || ""
		};
	});
}

function readEditorValue(question, control) {
	if (!control) {
		return question.type === "checkbox" ? [] : "";
	}

	if (question.type === "checkbox" && control instanceof HTMLSelectElement && control.multiple) {
		return Array.from(control.selectedOptions).map((option) => option.value);
	}

	return control.value;
}

function formatConfidence(value) {
	const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
	return `${Math.max(0, Math.min(100, Math.round(numeric)))}%`;
}

async function initializeFooter() {
	try {
		const response = await fetch(chrome.runtime.getURL("manifest.json"));
		const manifest = await response.json();
		const authorsData = manifest.author || [];
		const authors = parseAuthors(authorsData);
		renderAuthors(authors);
	} catch (error) {
		console.error("Erreur lors du chargement des auteurs:", error);
	}
}

function parseAuthors(authorsData) {
	if (!authorsData) {
		return [];
	}

	if (Array.isArray(authorsData)) {
		return authorsData.filter((author) => typeof author === "string" && author.trim()).map((author) => author.trim());
	}

	if (typeof authorsData === "string") {
		const parts = authorsData.split(" et ").map((s) => s.trim()).filter(Boolean);
		return parts;
	}

	return [];
}

function renderAuthors(authors) {
	if (!elements.authorsContainer || authors.length === 0) {
		return;
	}

	elements.authorsContainer.innerHTML = "";

	if (authors.length === 1) {
		elements.authorsContainer.appendChild(createAuthorLink(authors[0]));
	} else if (authors.length === 2) {
		elements.authorsContainer.appendChild(createAuthorLink(authors[0]));
		elements.authorsContainer.appendChild(document.createTextNode(" et "));
		elements.authorsContainer.appendChild(createAuthorLink(authors[1]));
	} else {
		for (let i = 0; i < authors.length; i++) {
			elements.authorsContainer.appendChild(createAuthorLink(authors[i]));
			if (i < authors.length - 2) {
				elements.authorsContainer.appendChild(document.createTextNode(", "));
			} else if (i === authors.length - 2) {
				elements.authorsContainer.appendChild(document.createTextNode(" et "));
			}
		}
	}
}

function createAuthorLink(author) {
	const link = document.createElement("a");
	link.href = `https://github.com/${author}`;
	link.target = "_blank";
	link.rel = "noopener noreferrer";
	link.className = "author-link";
	link.textContent = author;
	return link;
}

function requestFormDataFromActiveTab() {
	return chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
		const activeTab = tabs[0];

		if (!activeTab?.id) {
			throw new Error("Impossible d'identifier l'onglet actif.");
		}

		try {
			return await sendTabMessage(activeTab.id, { type: "EXTRACT_FORM_DATA" });
		} catch (error) {
			await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ["content.js"] });
			return sendTabMessage(activeTab.id, { type: "EXTRACT_FORM_DATA" });
		}
	});
}

function sendRuntimeMessage(message) {
	return new Promise((resolve, reject) => {
		chrome.runtime.sendMessage(message, (response) => {
			const runtimeError = chrome.runtime.lastError;

			if (runtimeError) {
				reject(new Error(runtimeError.message));
				return;
			}

			resolve(response);
		});
	});
}

function sendTabMessage(tabId, message) {
	return new Promise((resolve, reject) => {
		chrome.tabs.sendMessage(tabId, message, (response) => {
			const runtimeError = chrome.runtime.lastError;

			if (runtimeError) {
				reject(new Error(runtimeError.message));
				return;
			}

			resolve(response);
		});
	});
}

