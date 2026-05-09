if (!window.__googleCheatsBootstrapped) {
	window.__googleCheatsBootstrapped = true;

	const CONTROL_SELECTOR = [
		'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])',
		'select',
		'textarea',
		'[contenteditable="true"]',
		'[role="radio"]',
		'[role="checkbox"]',
		'[role="textbox"]',
		'[role="combobox"]',
		'[role="listbox"]'
	].join(', ');

	const GROUP_SELECTOR = 'fieldset, [role="radiogroup"], [role="group"], [role="listitem"], .question, [data-question], [data-group]';

	const cacheState = {
		snapshot: null,
		timerId: null
	};

	window.extractFormData = extractFormData;
	window.__googleCheatsState = cacheState;

	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message?.type === 'EXTRACT_FORM_DATA') {
			extractFormData()
				.then((payload) => sendResponse(payload))
				.catch((error) => sendResponse({ error: error.message || 'Extraction impossible.' }));
			return true;
		}

		return false;
	});

	startMutationObserver();
	scheduleCacheRefresh();

	async function extractFormData() {
		const questions = buildQuestionList();

		const snapshot = {
			form: {
				url: location.href,
				timestamp: new Date().toISOString(),
				title: document.title || '',
				questions
			}
		};

		cacheState.snapshot = snapshot;
		return snapshot;
	}

	function buildQuestionList() {
		const controls = Array.from(document.querySelectorAll(CONTROL_SELECTOR)).filter(isRelevantControl);
		const seen = new Set();
		const questions = [];

		controls.forEach((control, index) => {
			if (seen.has(control)) {
				return;
			}

			const controlType = getControlType(control);

			if (controlType === 'radio' || controlType === 'checkbox') {
				const groupContainer = findGroupContainer(control);
				const members = collectGroupMembers(control, controls, groupContainer);

				members.forEach((member) => seen.add(member));
				questions.push(buildQuestionFromGroup(control, members, groupContainer, index));
				return;
			}

			seen.add(control);
			questions.push(buildQuestionFromControl(control, index));
		});

		return questions.sort((left, right) => left.order - right.order).map((question) => {
			const { order, ...rest } = question;
			return rest;
		});
	}

	function buildQuestionFromGroup(control, members, groupContainer, order) {
		const questionMeta = resolveQuestionMeta(control, {
			type: getControlType(control),
			groupContainer,
			members
		});

		const options = members.map((member, index) => extractOptionFromControl(member, index));
		const representative = groupContainer || control;
		const dataElement = extractDataElement(representative) || extractDataElement(control);

		return {
			id: buildQuestionId(representative, questionMeta, control, dataElement),
			text: questionMeta.text,
			questionCandidate: questionMeta.questionCandidate || '',
			type: getControlType(control),
			required: detectRequired(control, groupContainer, questionMeta.text),
			options,
			answer: null,
			dataElement,
			description: getDescriptionText(control, groupContainer),
			confidence: questionMeta.confidence,
			evidence: questionMeta.evidence,
			order
		};
	}

	function buildQuestionFromControl(control, order) {
		const questionMeta = resolveQuestionMeta(control, { type: getControlType(control) });
		const dataElement = extractDataElement(control);
		const question = {
			id: buildQuestionId(control, questionMeta, control, dataElement),
			text: questionMeta.text,
			questionCandidate: questionMeta.questionCandidate || '',
			type: getControlType(control),
			required: detectRequired(control, null, questionMeta.text),
			options: getControlType(control) === 'select' ? extractSelectOptions(control) : null,
			answer: null,
			dataElement,
			placeholder: getPlaceholder(control),
			description: getDescriptionText(control),
			maxlength: getNumericAttribute(control, 'maxlength'),
			pattern: control.getAttribute('pattern') || null,
			autocomplete: control.getAttribute('autocomplete') || null,
			inputmode: control.getAttribute('inputmode') || null,
			confidence: questionMeta.confidence,
			evidence: questionMeta.evidence,
			order
		};

		if (getControlType(control) === 'textarea') {
			question.multiline = true;
		}

		return question;
	}

	function resolveQuestionMeta(control, options = {}) {
		const controlType = options.type || getControlType(control);
		const evidence = [];

		if (controlType !== 'radio' && controlType !== 'checkbox') {
			const directLabel = getLabelTextForControl(control);

			if (directLabel) {
				evidence.push('label[for]');
				return {
					text: cleanQuestionText(directLabel.text),
					questionCandidate: directLabel.text,
					confidence: 96,
					evidence,
					sourceId: directLabel.sourceId || control.id || ''
				};
			}
		}

		const explicitRefs = resolveReferencedText(control.getAttribute('aria-labelledby'));
		if (explicitRefs.text) {
			evidence.push('aria-labelledby');
			return {
				text: cleanQuestionText(explicitRefs.text),
				questionCandidate: explicitRefs.text,
				confidence: 91,
				evidence,
				sourceId: explicitRefs.sourceId || ''
			};
		}

		const ariaLabel = getAriaLabel(control);
		if (ariaLabel && controlType !== 'radio' && controlType !== 'checkbox') {
			evidence.push('aria-label');
			return {
				text: cleanQuestionText(ariaLabel),
				questionCandidate: ariaLabel,
				confidence: 84,
				evidence,
				sourceId: control.id || ''
			};
		}

		const scopeCandidates = [];

		if (options.groupContainer) {
			scopeCandidates.push(options.groupContainer);
		}

		let ancestor = control.parentElement;
		while (ancestor) {
			scopeCandidates.push(ancestor);
			ancestor = ancestor.parentElement;
		}

		for (const scope of scopeCandidates) {
			const scopedText = readQuestionTextFromScope(scope, control);
			if (scopedText.text) {
				evidence.push(...scopedText.evidence);
				return {
					text: cleanQuestionText(scopedText.text),
					questionCandidate: scopedText.text,
					confidence: scopedText.confidence,
					evidence,
					sourceId: scopedText.sourceId || ''
				};
			}
		}

		const placeholder = getPlaceholder(control);
		if (placeholder && controlType !== 'radio' && controlType !== 'checkbox') {
			evidence.push('placeholder');
			return {
				text: cleanQuestionText(placeholder),
				questionCandidate: placeholder,
				confidence: 61,
				evidence,
				sourceId: control.id || ''
			};
		}

		evidence.push('fallback');
		return {
			text: 'Question non identifiée',
			questionCandidate: '',
			confidence: 20,
			evidence,
			sourceId: control.id || ''
		};
	}

	function readQuestionTextFromScope(scope, targetControl) {
		if (!scope || !isElementVisible(scope)) {
			return { text: '', confidence: 0, evidence: [] };
		}

		const evidence = [];

		if (scope.tagName === 'FIELDSET') {
			const legend = scope.querySelector('legend');
			if (legend && isElementVisible(legend)) {
				evidence.push('fieldset>legend');
				return {
					text: getNodeText(legend),
					confidence: 95,
					evidence,
					sourceId: legend.id || ''
				};
			}
		}

		const ariaLabelledby = resolveReferencedText(scope.getAttribute?.('aria-labelledby'));
		if (ariaLabelledby.text) {
			evidence.push('scope aria-labelledby');
			return {
				text: ariaLabelledby.text,
				confidence: 90,
				evidence,
				sourceId: ariaLabelledby.sourceId || ''
			};
		}

		const ariaLabel = scope.getAttribute?.('aria-label');
		if (ariaLabel) {
			evidence.push('scope aria-label');
			return {
				text: ariaLabel,
				confidence: 86,
				evidence,
				sourceId: scope.id || ''
			};
		}

		const headingElements = Array.from(scope.querySelectorAll('legend, [role="heading"], h1, h2, h3, h4, h5, h6'));
		const orderedHeading = headingElements.find((heading) => {
			if (!targetControl || heading === targetControl) {
				return true;
			}

			return Boolean(heading.compareDocumentPosition(targetControl) & Node.DOCUMENT_POSITION_FOLLOWING);
		});

		if (orderedHeading && isElementVisible(orderedHeading)) {
			evidence.push(orderedHeading.tagName.toLowerCase());
			return {
				text: getNodeText(orderedHeading),
				confidence: 82,
				evidence,
				sourceId: orderedHeading.id || ''
			};
		}

		const directChildren = Array.from(scope.children || []);
		for (const child of directChildren) {
			if (!isElementVisible(child)) {
				continue;
			}

			if (child === targetControl || child.contains(targetControl)) {
				break;
			}

			if (matchesQuestionHeading(child)) {
				evidence.push('nearby heading');
				return {
					text: getNodeText(child),
					confidence: 74,
					evidence,
					sourceId: child.id || ''
				};
			}

			const childText = getNodeText(child);
			const controlCount = child.querySelectorAll ? child.querySelectorAll(CONTROL_SELECTOR).length : 0;
			if (childText && controlCount === 0 && childText.length < 120) {
				evidence.push('nearby text block');
				return {
					text: childText,
					confidence: 68,
					evidence,
					sourceId: child.id || ''
				};
			}
		}

		return { text: '', confidence: 0, evidence: [] };
	}

	function getLabelTextForControl(control) {
		if (!control.id) {
			return null;
		}

		const labels = Array.from(document.querySelectorAll(`label[for="${cssEscape(control.id)}"]`)).filter(isElementVisible);
		if (!labels.length) {
			return null;
		}

		const text = labels.map((label) => getNodeText(label)).filter(Boolean).join(' ');
		return text ? { text, sourceId: labels[0].id || control.id } : null;
	}

	function getDescriptionText(control, groupContainer = null) {
		const descriptions = [];

		[control, groupContainer].filter(Boolean).forEach((element) => {
			const describedBy = resolveReferencedText(element.getAttribute?.('aria-describedby'));
			if (describedBy.text) {
				descriptions.push(describedBy.text);
			}
		});

		return descriptions.filter(Boolean).join(' · ');
	}

	function resolveReferencedText(attributeValue) {
		if (!attributeValue) {
			return { text: '', sourceId: '' };
		}

		const ids = attributeValue.split(/\s+/).map((value) => value.trim()).filter(Boolean);
		const texts = [];

		for (const id of ids) {
			const node = document.getElementById(id);
			if (!node || !isElementVisible(node)) {
				continue;
			}

			const text = getNodeText(node);
			if (text) {
				texts.push(text);
			}
		}

		return {
			text: texts.join(' ').trim(),
			sourceId: ids[0] || ''
		};
	}

	function collectGroupMembers(control, allControls, groupContainer) {
		const controlType = getControlType(control);
		const name = getControlName(control);

		if (groupContainer) {
			const members = Array.from(groupContainer.querySelectorAll(CONTROL_SELECTOR)).filter((candidate) => {
				if (!isRelevantControl(candidate)) {
					return false;
				}

				const candidateType = getControlType(candidate);
				if (candidateType !== controlType) {
					return false;
				}

				if (name && getControlName(candidate) && getControlName(candidate) !== name) {
					return false;
				}

				return true;
			});

			if (members.length) {
				return members;
			}
		}

		if (name) {
			return allControls.filter((candidate) => getControlType(candidate) === controlType && getControlName(candidate) === name);
		}

		const container = control.closest(GROUP_SELECTOR) || control.parentElement;
		if (!container) {
			return [control];
		}

		return Array.from(container.querySelectorAll(CONTROL_SELECTOR)).filter((candidate) => getControlType(candidate) === controlType);
	}

	function buildQuestionId(sourceElement, questionMeta, control, dataElement) {
		const explicitId = questionMeta.sourceId || sourceElement.id || getControlName(control) || dataElement;
		if (explicitId) {
			return explicitId;
		}

		const signature = [questionMeta.text, getControlType(control), getControlName(control), dataElement || '', getElementSignature(sourceElement)].join('|');
		return `q_${hashString(signature)}`;
	}

	function extractSelectOptions(selectElement) {
		if (selectElement.tagName === 'SELECT') {
		return Array.from(selectElement.options).map((option, index) => ({
			value: option.value,
			label: option.label || getNodeText(option) || option.value,
			index,
			selected: option.selected
		}));
		}

		const optionNodes = Array.from(selectElement.querySelectorAll('[role="option"], option'));
		if (!optionNodes.length && selectElement.matches('[role="option"]')) {
			optionNodes.push(selectElement);
		}

		return optionNodes.map((option, index) => {
			const value = option.getAttribute?.('data-value') || option.getAttribute?.('value') || option.value || getNodeText(option);
			const label = option.getAttribute?.('aria-label') || getNodeText(option) || value;
			const selected = option.getAttribute?.('aria-selected') === 'true' || option.selected || option.classList?.contains('selected');

			return {
				value,
				label,
				index,
				selected
			};
		});
	}

	function extractOptionFromControl(control, index) {
		const value = getControlValue(control);
		const label = getControlLabel(control);

		return {
			value: value || label || `option_${index + 1}`,
			label: label || value || `Option ${index + 1}`,
			index,
			selected: Boolean(control.checked)
		};
	}

	function extractDataElement(control) {
		const ancestors = [control, ...getAncestorChain(control)];

		for (const element of ancestors) {
			const directEntry = element.getAttribute?.('data-entry');
			if (directEntry) {
				return directEntry;
			}

			const entryId = element.getAttribute?.('data-entry-id');
			if (entryId) {
				return entryId;
			}

			const questionId = element.getAttribute?.('data-question-id');
			if (questionId) {
				return questionId;
			}

			const dataParams = element.getAttribute?.('data-params');
			if (dataParams) {
				const nestedEntry = dataParams.match(/\[\[(\d+),/);
				if (nestedEntry) {
					return `entry.${nestedEntry[1]}`;
				}
			}

			const name = getControlName(element);
			if (name && /entry\.\d+/i.test(name)) {
				return name.match(/entry\.\d+/i)[0];
			}
		}

		return '';
	}

	function getControlType(control) {
		if (control.matches('[role="radio"]')) {
			return 'radio';
		}

		if (control.matches('[role="checkbox"]')) {
			return 'checkbox';
		}

		if (control.matches('[role="textbox"]') || control.matches('[contenteditable="true"]')) {
			return 'text';
		}

		if (control.matches('[role="combobox"], [role="listbox"]')) {
			return 'select';
		}

		if (control.tagName === 'SELECT') {
			return 'select';
		}

		if (control.tagName === 'TEXTAREA') {
			return 'textarea';
		}

		if (control.tagName === 'INPUT') {
			const type = (control.type || 'text').toLowerCase();

			if (['radio', 'checkbox'].includes(type)) {
				return type;
			}

			if (['date', 'email', 'number', 'tel', 'url', 'search', 'time', 'month', 'week', 'password', 'text'].includes(type)) {
				return type === 'text' ? 'text' : type;
			}

			return 'text';
		}

		return 'text';
	}

	function getControlName(control) {
		return control.getAttribute?.('name') || control.getAttribute?.('data-name') || '';
	}

	function getControlValue(control) {
		if (control.tagName === 'INPUT') {
			return control.value || control.getAttribute('value') || '';
		}

		if (control.tagName === 'SELECT') {
			return control.value || '';
		}

		return control.getAttribute?.('data-value') || control.textContent?.trim() || '';
	}

	function getControlLabel(control) {
		const ariaLabel = getAriaLabel(control);
		if (ariaLabel) {
			return ariaLabel;
		}

		const labelElement = control.closest('label');
		if (labelElement) {
			return getNodeText(labelElement);
		}

		if (control.id) {
			const explicitLabel = document.querySelector(`label[for="${cssEscape(control.id)}"]`);
			if (explicitLabel) {
				return getNodeText(explicitLabel);
			}
		}

		const siblingLabel = control.parentElement?.querySelector('span, label');
		if (siblingLabel && siblingLabel !== control) {
			const siblingText = getNodeText(siblingLabel);
			if (siblingText) {
				return siblingText;
			}
		}

		return getNodeText(control);
	}

	function getAriaLabel(control) {
		const ariaLabel = control.getAttribute?.('aria-label');
		if (ariaLabel) {
			return ariaLabel;
		}

		const labelledby = resolveReferencedText(control.getAttribute?.('aria-labelledby'));
		return labelledby.text || '';
	}

	function getPlaceholder(control) {
		return control.getAttribute?.('placeholder') || '';
	}

	function getNumericAttribute(control, attributeName) {
		const rawValue = control.getAttribute?.(attributeName);
		if (!rawValue) {
			return null;
		}

		const numericValue = Number(rawValue);
		return Number.isFinite(numericValue) ? numericValue : rawValue;
	}

	function detectRequired(control, groupContainer, questionText) {
		if (control.required || control.getAttribute?.('aria-required') === 'true') {
			return true;
		}

		if (groupContainer && groupContainer.getAttribute?.('aria-required') === 'true') {
			return true;
		}

		const probeText = `${questionText || ''} ${getDescriptionText(control, groupContainer)}`.toLowerCase();
		return /\b(obligatoire|required|mandatory)\b/.test(probeText) || /\*/.test(questionText || '');
	}

	function findGroupContainer(control) {
		let ancestor = control.parentElement;

		while (ancestor) {
			if (ancestor.matches(GROUP_SELECTOR) || ancestor.getAttribute?.('role') === 'radiogroup') {
				return ancestor;
			}

			ancestor = ancestor.parentElement;
		}

		return null;
	}

	function isRelevantControl(control) {
		if (!isElementVisible(control)) {
			return false;
		}

		if (control.tagName === 'INPUT') {
			return !['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes((control.type || '').toLowerCase());
		}

		return true;
	}

	function isElementVisible(element) {
		if (!element || !(element instanceof Element)) {
			return false;
		}

		if (element.hidden || element.getAttribute?.('aria-hidden') === 'true') {
			return false;
		}

		const style = window.getComputedStyle(element);
		if (style.display === 'none' || style.visibility === 'hidden') {
			return false;
		}

		if (element.tagName === 'OPTION') {
			return true;
		}

		const rect = element.getBoundingClientRect();
		return rect.width > 0 || rect.height > 0 || element.matches('[role="radio"], [role="checkbox"], [role="textbox"], [role="combobox"], [contenteditable="true"]');
	}

	function matchesQuestionHeading(element) {
		return element.matches('legend, [role="heading"], h1, h2, h3, h4, h5, h6, .question, [data-question-text]');
	}

	function cleanQuestionText(text) {
		return normalizeWhitespace(String(text || '')).replace(/\s*\*\s*$/, '').replace(/\s*\(obligatoire\)\s*$/i, '').trim() || 'Question non identifiée';
	}

	function normalizeWhitespace(text) {
		return String(text || '').replace(/\s+/g, ' ').trim();
	}

	function getNodeText(node) {
		if (!node) {
			return '';
		}

		if (node.tagName === 'INPUT' || node.tagName === 'SELECT' || node.tagName === 'TEXTAREA') {
			return normalizeWhitespace(node.getAttribute?.('aria-label') || node.getAttribute?.('placeholder') || node.value || node.textContent || '');
		}

		return normalizeWhitespace(node.innerText || node.textContent || '');
	}

	function getAncestorChain(element) {
		const ancestors = [];
		let current = element.parentElement;

		while (current) {
			ancestors.push(current);
			current = current.parentElement;
		}

		return ancestors;
	}

	function getElementSignature(element) {
		const parts = [];
		let current = element;

		while (current && current !== document.body) {
			const descriptor = [current.tagName.toLowerCase()];

			if (current.id) {
				descriptor.push(`#${current.id}`);
			}

			const name = current.getAttribute?.('name');
			if (name) {
				descriptor.push(`[name="${name}"]`);
			}

			const role = current.getAttribute?.('role');
			if (role) {
				descriptor.push(`[role="${role}"]`);
			}

			const parent = current.parentElement;
			if (parent) {
				const index = Array.from(parent.children).indexOf(current);
				descriptor.push(`:nth(${index})`);
			}

			parts.unshift(descriptor.join(''));
			current = current.parentElement;
		}

		return parts.join('>');
	}

	function hashString(value) {
		let hash = 0;

		for (let index = 0; index < value.length; index += 1) {
			hash = (hash << 5) - hash + value.charCodeAt(index);
			hash |= 0;
		}

		return Math.abs(hash).toString(36);
	}

	function cssEscape(value) {
		if (window.CSS && typeof window.CSS.escape === 'function') {
			return window.CSS.escape(value);
		}

		return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
	}

	function startMutationObserver() {
		const root = document.body || document.documentElement;
		if (!root || typeof MutationObserver === 'undefined') {
			return;
		}

		const observer = new MutationObserver(scheduleCacheRefresh);
		observer.observe(root, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
			attributeFilter: ['aria-label', 'aria-labelledby', 'aria-required', 'required', 'name', 'id', 'placeholder', 'value', 'data-entry', 'data-entry-id', 'data-params']
		});

		window.__googleCheatsObserver = observer;
	}

	function scheduleCacheRefresh() {
		if (cacheState.timerId) {
			clearTimeout(cacheState.timerId);
		}

		cacheState.timerId = window.setTimeout(() => {
			extractFormData().catch(() => null);
		}, 350);
	}
}
