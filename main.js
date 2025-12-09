const FINAL_PHRASE = 'Pronto! Copia e cola. Manda o próximo! 🚀';

const GEMINI_KEY_STORAGE = 'formatadorBonificacoesGeminiKey';

const labelMatchers = [
  {
    key: 'autSup',
    patterns: ['AUT SUP', 'AUTORIZACAO SUP', 'AUTORIZACAO SUPERVISOR', 'AUTORIZACAO SUPERVISAO'],
  },
  {
    key: 'pedido',
    patterns: ['PEDIDO', 'PEDIDOS', 'NUMERO PEDIDO', 'PEDIDO AURORA', 'PEDIDO SAP'],
  },
  {
    key: 'itens',
    patterns: [
      'ITENS NEGOCIADOS',
      'ITENS',
      'PRODUTOS NEGOCIADOS',
      'SKU',
      'ITENS SOLICITADOS',
      'MIX',
    ],
  },
  {
    key: 'bonificacao',
    patterns: [
      'BONIFICACAO',
      'BONIFICACOES',
      'BONIFICACAO SOLICITADA',
      'BONUS',
      'BRINDE',
      'AMOSTRA',
    ],
  },
  { key: 'motivo', patterns: ['MOTIVO', 'JUSTIFICATIVA', 'RAZAO', 'MOTIVACAO'] },
  { key: 'cnpj', patterns: ['CNPJ', 'CNPJ/CPF', 'DOC CNPJ'] },
  {
    key: 'dataEntrega',
    patterns: ['DATA ENTREGA', 'DATA DE ENTREGA', 'ENTREGA', 'PREVISAO ENTREGA', 'ENTREGA PREVISTA'],
  },
  { key: 'observacoes', patterns: ['OBSERVACAO', 'OBSERVACOES', 'OBS', 'COMENTARIOS'] },
];

const multiLineKeys = new Set(['itens', 'bonificacao', 'motivo', 'observacoes']);

const rawInput = document.getElementById('raw-input');
const formattedOutput = document.getElementById('formatted-output');
const copyButton = document.getElementById('copy-btn');
const copyFeedback = document.getElementById('copy-feedback');
const clearButton = document.getElementById('clear-input');
const demoButton = document.getElementById('demo-input');
const aiForm = document.getElementById('ai-form');
const aiKeyInput = document.getElementById('ai-key');
const aiModelSelect = document.getElementById('ai-model');
const aiStatus = document.getElementById('ai-status');
const forgetKeyButton = document.getElementById('forget-key');

const demoText = `AUT SUP: 874563
Pedido Aurora: AU-998877 / AU-998878
Itens negociados:
123456 - 20 kg peito IQF
654321 - 20 kg coxa c/ sobrecoxa
987654 - 40 kg linguiça calabresa
Bonificação solicitada:
123456 - 10 pacotes
654321 - 5 caixas
Motivo: Evento degustação loja flagship 15/12
CNPJ: 12.345.678/0001-90
Data de entrega prevista: 15/12
Endereço entrega: Rua das Flores, 1000 - Auditório Eventos`;

const DEFAULT_BLOCK = wrapWithCode([
  'AUT SUP: ',
  'PEDIDO: ',
  'ITENS NEGOCIADOS: ',
  'BONIFICAÇÃO: ',
  'MOTIVO: ',
  'CNPJ: ',
  'DATA ENTREGA: ',
]);

function init() {
  if (!rawInput || !formattedOutput) return;
  formattedOutput.value = DEFAULT_BLOCK;
  restoreSavedKey();
  rawInput.addEventListener('input', () => {
    formattedOutput.value = formatBlock(rawInput.value);
  });

  clearButton?.addEventListener('click', () => {
    rawInput.value = '';
    formattedOutput.value = DEFAULT_BLOCK;
    rawInput.focus();
  });

  demoButton?.addEventListener('click', () => {
    rawInput.value = demoText;
    formattedOutput.value = formatBlock(demoText);
  });

  copyButton?.addEventListener('click', async () => {
    if (!formattedOutput.value.trim()) return;
    try {
      await navigator.clipboard.writeText(formattedOutput.value.trim());
      setTransientMessage('Bloco copiado!', 2000);
    } catch (error) {
      setTransientMessage('Não foi possível copiar automaticamente.', 3000);
    }
  });

  if (aiForm) {
    aiForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await sendToAI();
    });
  }

  forgetKeyButton?.addEventListener('click', () => {
    clearSavedKey();
    if (aiKeyInput) {
      aiKeyInput.value = '';
    }
    if (aiStatus) {
      aiStatus.textContent = 'Chave removida deste navegador.';
    }
  });
}

function formatBlock(rawText = '') {
  const parsed = parseRaw(rawText);
  const lines = [
    `AUT SUP: ${parsed.autSup}`,
    `PEDIDO: ${parsed.pedido}`,
    `ITENS NEGOCIADOS: ${parsed.itens}`,
    `BONIFICAÇÃO: ${parsed.bonificacao}`,
    `MOTIVO: ${parsed.motivo}`,
    `CNPJ: ${parsed.cnpj}`,
    `DATA ENTREGA: ${parsed.dataEntrega}`,
  ];

  if (parsed.observacoes) {
    lines.push(parsed.observacoes.startsWith('OBS') ? parsed.observacoes : `OBS: ${parsed.observacoes}`);
  }

  return wrapWithCode(lines);
}

function parseRaw(rawText = '') {
  const bucket = {
    autSup: '',
    pedido: '',
    itens: [],
    bonificacao: [],
    motivo: [],
    cnpj: '',
    dataEntrega: '',
    observacoes: [],
  };

  if (!rawText.trim()) {
    return finalizeBucket(bucket, rawText);
  }

  const lines = rawText.split(/\r?\n/);
  let currentKey = null;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const normalized = normalizeLine(trimmed);
    const matched = labelMatchers.find(({ patterns }) =>
      patterns.some((pattern) => normalized.startsWith(pattern)),
    );

    if (matched) {
      currentKey = matched.key;
      assignValue(bucket, currentKey, trimmed);
      return;
    }

    if (currentKey && multiLineKeys.has(currentKey)) {
      assignValue(bucket, currentKey, trimmed);
      return;
    }

    detectInlineValues(bucket, trimmed);
  });

  return finalizeBucket(bucket, rawText);
}

function assignValue(bucket, key, content) {
  const value = extractValue(content);
  if (!value) return;

  switch (key) {
    case 'cnpj':
      bucket.cnpj = sanitizeCnpj(value) || bucket.cnpj;
      break;
    case 'dataEntrega':
      bucket.dataEntrega = normalizeDate(value) || bucket.dataEntrega;
      break;
    case 'motivo':
    case 'observacoes':
      bucket[key].push(value);
      break;
    case 'itens':
    case 'bonificacao':
      bucket[key].push(value);
      break;
    case 'pedido':
      bucket.pedido = mergeValues(bucket.pedido, value);
      break;
    case 'autSup':
      bucket.autSup = mergeValues(bucket.autSup, value);
      break;
    default:
      bucket[key] = value;
  }
}

function detectInlineValues(bucket, line) {
  if (!bucket.cnpj) {
    const cnpj = sanitizeCnpj(line);
    if (cnpj) bucket.cnpj = cnpj;
  }

  if (!bucket.dataEntrega) {
    const maybeDate = normalizeDate(line);
    if (maybeDate) bucket.dataEntrega = maybeDate;
  }
}

function finalizeBucket(bucket, rawText) {
  if (!bucket.cnpj) {
    bucket.cnpj = fallbackCnpj(rawText);
  }
  if (!bucket.dataEntrega) {
    bucket.dataEntrega = fallbackDate(rawText);
  }

  return {
    autSup: bucket.autSup.trim(),
    pedido: bucket.pedido.trim(),
    itens: normalizeList(bucket.itens).join(' / '),
    bonificacao: normalizeBonificacao(bucket.bonificacao),
    motivo: collapse(bucket.motivo),
    cnpj: bucket.cnpj,
    dataEntrega: bucket.dataEntrega,
    observacoes: collapse(bucket.observacoes),
  };
}

function extractValue(line) {
  if (!line) return '';
  const colonIndex = line.indexOf(':');
  if (colonIndex >= 0) return line.slice(colonIndex + 1).trim();
  const dashIndex = line.indexOf('-');
  if (dashIndex >= 0 && dashIndex < 20) return line.slice(dashIndex + 1).trim();
  return line.replace(/^[^\s]+\s*/, '').trim();
}

function normalizeLine(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\t•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .trim();
}

function sanitizeCnpj(value) {
  if (!value) return '';
  const digits = (value.match(/\d/g) || []).join('');
  if (digits.length >= 14) {
    return digits.slice(0, 14);
  }
  return '';
}

function normalizeDate(value) {
  if (!value) return '';
  const match = value.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!match) return '';
  let [, day, month, year] = match;
  day = day.padStart(2, '0');
  month = month.padStart(2, '0');
  let numericYear = Number(year);
  if (year.length === 2) {
    numericYear = numericYear < 50 ? numericYear + 2000 : numericYear + 1900;
  }
  if (year.length === 3) {
    numericYear = Number(`2${year}`);
  }
  if (!numericYear || Number.isNaN(numericYear)) return '';
  return `${day}/${month}/${numericYear}`;
}

function fallbackCnpj(text) {
  if (!text) return '';
  const labeled = text.match(/CNPJ[^0-9]*([\d./-]{14,})/i);
  if (labeled) {
    const cleaned = sanitizeCnpj(labeled[1]);
    if (cleaned) return cleaned;
  }
  const digitsOnly = text.match(/\b\d{14}\b/);
  return digitsOnly ? digitsOnly[0] : '';
}

function fallbackDate(text) {
  if (!text) return '';
  const match = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  return match ? normalizeDate(match[0]) : '';
}

function normalizeList(values) {
  return values
    .map((item) => item.replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean);
}

function normalizeBonificacao(values) {
  return normalizeList(values)
    .map((item) =>
      item
        .replace(/\b(pacotes?|pacote|pac|pct|pcts|pc|pcs?|packs?)\b/gi, 'un')
        .replace(/\b(caixas?|caixa|cx\.?|cxs?)\b/gi, 'cx')
        .replace(/\b(unitarios?)\b/gi, 'un')
        .trim(),
    )
    .filter(Boolean)
    .join(' / ');
}

function collapse(values) {
  return normalizeList(values).join(' ');
}

function wrapWithCode(lines) {
  const content = Array.isArray(lines) ? lines.join('\n') : lines;
  return `\`\`\`\n${content.trimEnd()}\n\`\`\`\n\n${FINAL_PHRASE}`;
}

function mergeValues(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming || existing.includes(incoming)) return existing;
  return `${existing} / ${incoming}`;
}

function setTransientMessage(message, duration = 2000) {
  if (!copyFeedback) return;
  const previous = copyFeedback.textContent;
  copyFeedback.textContent = message;
  setTimeout(() => {
    copyFeedback.textContent = previous;
  }, duration);
}

async function sendToAI() {
  if (!aiKeyInput || !aiModelSelect || !aiStatus) return;
  const apiKey = aiKeyInput.value.trim();
  if (!apiKey) {
    aiStatus.textContent = 'Informe sua chave do Gemini para usar a IA.';
    return;
  }

  const content = rawInput.value.trim();
  if (!content) {
    aiStatus.textContent = 'Cole uma solicitação antes de enviar para a IA.';
    return;
  }

  aiStatus.textContent = 'Enviando para a IA...';
  persistKey(apiKey);

  const model = aiModelSelect.value || 'gemini-2.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    systemInstruction: {
      parts: [
        {
          text:
            'Você é um assistente que padroniza solicitações de bonificação. Responda apenas com o bloco em markdown (``` ... ```) contendo as linhas AUT SUP, PEDIDO, ITENS NEGOCIADOS, BONIFICAÇÃO, MOTIVO, CNPJ e DATA ENTREGA (nessa ordem) e finalize com a frase “Pronto! Copia e cola. Manda o próximo! 🚀”. Não acrescente nenhum comentário extra.',
        },
      ],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: content }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error?.message || 'Falha ao chamar a IA.');
    }

    const formatted = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('\n')
      .trim();
    if (formatted) {
      formattedOutput.value = enforceCnpjDigits(formatted);
      aiStatus.textContent = 'Resposta gerada pela IA ✔️';
    } else {
      aiStatus.textContent = 'IA respondeu sem conteúdo utilizável.';
    }
  } catch (error) {
    aiStatus.textContent = `Erro: ${error.message}`;
  }
}

function persistKey(value) {
  if (!value) return;
  try {
    localStorage.setItem(GEMINI_KEY_STORAGE, value);
  } catch (error) {
    console.warn('Não foi possível salvar a chave localmente.', error);
  }
}

function restoreSavedKey() {
  if (!aiKeyInput) return;
  try {
    const saved = localStorage.getItem(GEMINI_KEY_STORAGE);
    if (saved) {
      aiKeyInput.value = saved;
      if (aiStatus) {
        aiStatus.textContent = 'Chave carregada do navegador ✔️';
      }
    }
  } catch (error) {
    console.warn('Não foi possível ler a chave salva.', error);
  }
}

function clearSavedKey() {
  try {
    localStorage.removeItem(GEMINI_KEY_STORAGE);
  } catch (error) {
    console.warn('Não foi possível remover a chave salva.', error);
  }
}

function enforceCnpjDigits(blockText = '') {
  if (!blockText) return blockText;
  return blockText.replace(/(CNPJ:\s*)([^\n]*)/i, (match, label, value) => {
    const sanitized = sanitizeCnpj(value);
    if (sanitized) return `${label}${sanitized}`;
    const digits = (value.match(/\d/g) || []).join('');
    return `${label}${digits || value.trim()}`;
  });
}

init();
