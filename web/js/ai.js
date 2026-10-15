// The AI assistant: turns an idea into a plan (tasks, schedule blocks, habits, goals, notes,
// vision words) and adds the parts you pick. Runs on Ollama (this computer) or Google Gemini.

import { state } from './store.js';
import { uid, today, addDays, parseKey, WEEKDAYS, COLORS } from './utils.js';
import { entriesFor, hourLabel } from './views/schedule.js';
import { CATEGORIES } from './views/goals.js';

export const PROVIDERS = {
  ollama: 'On this computer (Ollama)',
  gemini: 'Google Gemini',
};
// Small enough for a 4 GB graphics card, good at following a JSON format.
export const DEFAULT_OLLAMA_MODEL = 'qwen3:4b';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const str = (description) => ({ type: 'string', description });
const SCHEMA = {
  type: 'object',
  properties: {
    reply: str('A short, friendly message to the user (1-3 sentences) about the plan or answering their question.'),
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: str('Short actionable task'),
          due: { type: 'string', description: 'YYYY-MM-DD or empty' },
          priority: { type: 'integer', description: '1 urgent, 2 high, 3 medium, 4 none', minimum: 1, maximum: 4 },
          notes: str('Optional details, or empty'),
        },
        required: ['title', 'due', 'priority', 'notes'],
      },
    },
    schedule: {
      type: 'array',
      description: 'Time blocks in the weekly schedule (06:00-24:00)',
      items: {
        type: 'object',
        properties: {
          title: str('What happens in this block'),
          days: { type: 'array', items: { type: 'string', enum: DAY_NAMES } },
          start: { type: 'integer', description: 'Start hour, 6-23', minimum: 6, maximum: 23 },
          hours: { type: 'integer', description: 'Length in whole hours', minimum: 1, maximum: 18 },
          weekly: { type: 'boolean', description: 'true = repeats every week; false = only this coming week' },
        },
        required: ['title', 'days', 'start', 'hours', 'weekly'],
      },
    },
    habits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: str('Habit name'),
          emoji: str('One emoji'),
          days: { type: 'array', items: { type: 'string', enum: DAY_NAMES } },
          goal: str('Title of the goal (from this plan or existing) it supports, or empty'),
        },
        required: ['name', 'emoji', 'days', 'goal'],
      },
    },
    goals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: str('The goal'),
          why: str('Why it matters, one sentence'),
          category: { type: 'string', enum: Object.keys(CATEGORIES) },
          deadline: { type: 'string', description: 'YYYY-MM-DD or empty' },
          milestones: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'why', 'category', 'deadline', 'milestones'],
      },
    },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: str('Note title'), body: str('Note text, may use markdown lists') },
        required: ['title', 'body'],
      },
    },
    vision: {
      type: 'array',
      description: 'Affirmations or intentions for the vision board',
      items: { type: 'object', properties: { text: str('Short affirmation') }, required: ['text'] },
    },
  },
  required: ['reply', 'tasks', 'schedule', 'habits', 'goals', 'notes', 'vision'],
};

function systemPrompt() {
  const t = today();
  const week = Array.from({ length: 7 }, (_, i) => addDays(t, i));
  // Small models get dates wrong when they work them out, so they get a calendar to look up instead.
  const calendar = Array.from({ length: 14 }, (_, i) => addDays(t, i))
    .map((d, i) => `${WEEKDAYS[parseKey(d).getDay()]} ${d}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}`).join(', ');
  const nextDays = Array.from({ length: 7 }, (_, i) => addDays(t, i + 1))
    .map((d) => `"${WEEKDAYS[parseKey(d).getDay()]}" or "by ${WEEKDAYS[parseKey(d).getDay()]}" = ${d}`).join('; ');
  const busy = week.flatMap((d) => entriesFor(d).map((e) =>
    `${WEEKDAYS[parseKey(d).getDay()]} ${hourLabel(e.hour)}-${hourLabel(e.hour + e.duration)} ${e.text}`));
  const goals = state.goals.items.filter((g) => g.status === 'active').map((g) => g.title);
  const habits = state.habits.items.filter((h) => !h.archived).map((h) => h.name);
  const name = state.settings.name;

  return `You are the planning assistant inside To-doist, a personal app with a to-do list, a weekly schedule
(one row per hour, 06:00-24:00), habits, goals with milestones, notes and a vision board.
${name ? `The user's name is ${name}. ` : ''}Today is ${WEEKDAYS[parseKey(t).getDay()]} ${t}.
Calendar (copy dates from here, never calculate them): ${calendar}
When the user names a weekday: ${nextDays}.

Turn what the user says into a concrete, realistic plan using the JSON format you are given.
Put each thing in exactly ONE place:
- schedule: activities the user mentioned that happen at a fixed time. Whole hours.
- habits: small repeated actions the user mentioned that have no fixed time.
- tasks: one-off things to do, with a due date from the calendar when timing matters.
- goals: big outcomes needing several steps; give 3-6 concrete milestones. Don't also add a task with the same meaning.
- notes: useful information, ideas, lists or drafts to keep.
- vision: only when the user talks about dreams, motivation or who they want to become.
Rules:
- Never invent activities the user didn't ask for, except milestones for a goal.
- Spread repeated activities over the week sensibly (e.g. "3 times a week" = Mon, Wed, Fri).
- Schedule blocks must not overlap each other or the existing blocks listed below.
- A habit's "goal" must be exactly the title of a goal in your plan or in the active goals below, otherwise "".
- Only include what the request needs; leave other lists empty. If the user only asks a question,
  answer in "reply" and leave all lists empty.
- Reply in the same language the user writes in.

Already in the schedule for the next 7 days:
${busy.length ? busy.join('\n') : '(nothing)'}
Active goals: ${goals.length ? goals.join('; ') : '(none)'}
Habits: ${habits.length ? habits.join('; ') : '(none)'}`;
}

// ---- Talking to the providers ----

async function call(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(errorMessage(text) || `Error ${res.status}`);
  return JSON.parse(text);
}

function errorMessage(text) {
  try {
    const j = JSON.parse(text);
    const msg = j.error?.message || j.error || '';
    if (/location is not supported/i.test(msg)) return 'Google Gemini is not available in your country. Use the Ollama option instead.';
    if (/API key not valid/i.test(msg)) return 'The Gemini API key is not valid. Check it in Settings.';
    if (/quota|RESOURCE_EXHAUSTED/i.test(msg)) return 'The free Gemini limit is used up for now. Try again later, or switch to Ollama in Settings.';
    if (/model .* not found/i.test(msg)) return `${msg}. Pick an installed model in Settings.`;
    return msg;
  } catch {
    return text.slice(0, 300);
  }
}

/** history: [{ role: 'user' | 'assistant', content }]. Returns a plan object. */
export async function askPlan(history) {
  const ai = state.settings.ai;
  const system = systemPrompt();
  let content;
  if (ai.provider === 'gemini') {
    if (!ai.geminiModel) throw new Error('Choose a Gemini model in Settings first.');
    const data = await call(`/api/ai/gemini/generate?model=${encodeURIComponent(ai.geminiModel)}`, {
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: SCHEMA, temperature: 0.5 },
    });
    content = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
    if (!content) throw new Error(data.promptFeedback?.blockReason ? 'Gemini refused to answer this.' : 'Gemini sent an empty answer.');
  } else {
    const body = {
      model: ai.ollamaModel || DEFAULT_OLLAMA_MODEL,
      messages: [{ role: 'system', content: system }, ...history],
      format: SCHEMA,
      stream: false,
      think: false, // reasoning first took 5+ minutes per answer on a 4 GB graphics card
      options: { temperature: 0.5, num_ctx: 8192 },
    };
    let data;
    try {
      data = await call('/api/ai/ollama/chat', body);
    } catch (err) {
      if (!/think/i.test(err.message)) throw err;
      delete body.think; // models without a thinking mode reject the option
      data = await call('/api/ai/ollama/chat', body);
    }
    content = data.message?.content;
  }
  const plan = normalize(JSON.parse(content));
  // Small models often put one thing in two places; keep the more structured one.
  const key = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const goalKeys = new Set(plan.goals.map((g) => key(g.title)));
  const blockKeys = new Set(plan.schedule.map((s) => key(s.title)));
  plan.tasks = plan.tasks.filter((x) => !goalKeys.has(key(x.title)));
  plan.habits = plan.habits.filter((h) => !blockKeys.has(key(h.name)));
  // Drop links to goals that don't exist, so the preview doesn't promise one.
  const goalTitles = [...plan.goals, ...state.goals.items].map((g) => g.title.toLowerCase());
  plan.habits.forEach((h) => { if (!goalTitles.includes(h.goal.toLowerCase())) h.goal = ''; });
  return plan;
}

export async function listOllamaModels() {
  const res = await fetch('/api/ai/ollama/tags');
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).models.map((m) => m.name);
}

export async function listGeminiModels() {
  const res = await fetch('/api/ai/gemini/models');
  const text = await res.text();
  if (!res.ok) throw new Error(errorMessage(text));
  return JSON.parse(text).models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/.test(m.name)
      && !/image|tts|audio|live|embedding|robotics|computer/.test(m.name))
    .map((m) => m.name.replace(/^models\//, ''));
}

/** Picks a fast, free-tier friendly model: the newest stable "flash". */
export function pickGeminiModel(models) {
  const stable = models.filter((m) => /^gemini-[\d.]+-flash$/.test(m));
  const version = (m) => parseFloat(m.match(/[\d.]+/)[0]);
  return stable.sort((a, b) => version(b) - version(a))[0]
    || models.find((m) => m.includes('flash') && !m.includes('lite')) || models[0] || '';
}

export async function hasGeminiKey() {
  try { return (await (await fetch('/api/ai/key')).json()).gemini; } catch { return false; }
}

export async function saveGeminiKey(key) {
  const res = await fetch('/api/ai/key', { method: 'PUT', body: key });
  if (!res.ok) throw new Error(await res.text());
}

// ---- Turning a plan into items ----

const arr = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const days = (v) => [...new Set(arr(v).map((d) => DAY_NAMES.indexOf(d)).filter((i) => i >= 0).map((i) => (i + 1) % 7))];

/** Cleans up whatever the model sent so the rest of the app can rely on it. */
function normalize(p) {
  const hour = (h) => Math.min(23, Math.max(6, Math.round(+h) || 9));
  return {
    reply: text(p.reply),
    tasks: arr(p.tasks).filter((t) => text(t.title)).map((t) => ({
      title: text(t.title), due: date(t.due), priority: [1, 2, 3, 4].includes(+t.priority) ? +t.priority : 4, notes: text(t.notes),
    })),
    schedule: arr(p.schedule).filter((s) => text(s.title) && days(s.days).length).map((s) => {
      const start = hour(s.start);
      return { title: text(s.title), days: days(s.days), start, hours: Math.min(24 - start, Math.max(1, Math.round(+s.hours) || 1)), weekly: s.weekly !== false };
    }),
    habits: arr(p.habits).filter((h) => text(h.name)).map((h) => ({
      name: text(h.name), emoji: text(h.emoji) || '✅', days: days(h.days).length ? days(h.days) : [0, 1, 2, 3, 4, 5, 6], goal: text(h.goal),
    })),
    goals: arr(p.goals).filter((g) => text(g.title)).map((g) => ({
      title: text(g.title), why: text(g.why), category: CATEGORIES[g.category] ? g.category : 'Other',
      deadline: date(g.deadline), milestones: arr(g.milestones).map(text).filter(Boolean),
    })),
    notes: arr(p.notes).filter((n) => text(n.title) || text(n.body)).map((n) => ({ title: text(n.title), body: text(n.body) })),
    vision: arr(p.vision).filter((v) => text(v.text)).map((v) => ({ text: text(v.text) })),
  };
}

/** A plan as the model wrote it (weekday names instead of numbers), for showing it its own earlier answer. */
export function planForModel(plan) {
  const names = (ds) => ds.map((d) => DAY_NAMES[(d + 6) % 7]);
  return JSON.stringify({
    ...plan,
    schedule: plan.schedule.map((s) => ({ ...s, days: names(s.days) })),
    habits: plan.habits.map((h) => ({ ...h, days: names(h.days) })),
  });
}

export const SECTIONS =['goals', 'tasks', 'schedule', 'habits', 'notes', 'vision'];
export const planSize = (plan) => SECTIONS.reduce((n, k) => n + plan[k].length, 0);

/** Adds the chosen parts of a plan. pick: { tasks: [indexes], ... }. Returns how many items were added. */
export function applyPlan(plan, pick) {
  const now = Date.now();
  const t = today();
  const monday = addDays(t, -((parseKey(t).getDay() + 6) % 7));
  const chosen = (k) => plan[k].filter((_, i) => pick[k].includes(i));
  let added = 0;

  const goalIds = {};
  for (const g of chosen('goals')) {
    const id = uid();
    goalIds[g.title.toLowerCase()] = id;
    state.goals.items.push({
      id, title: g.title, why: g.why, category: g.category, deadline: g.deadline, type: 'milestones',
      start: 0, target: 0, unit: '', current: 0, status: 'active', createdAt: now, log: [],
      milestones: g.milestones.map((title) => ({ id: uid(), title, done: false })),
    });
    added++;
  }
  const goalFor = (title) => goalIds[title.toLowerCase()]
    || state.goals.items.find((g) => g.title.toLowerCase() === title.toLowerCase())?.id || '';

  for (const task of chosen('tasks')) {
    state.todo.tasks.push({
      id: uid(), title: task.title, notes: task.notes, due: task.due, priority: task.priority, listId: 'inbox',
      repeat: 'none', subtasks: [], done: false, doneAt: null, createdAt: now,
    });
    added++;
  }

  const colorOf = {};
  for (const s of chosen('schedule')) {
    const color = colorOf[s.title] ??= COLORS[Object.keys(colorOf).length % COLORS.length];
    for (const dow of s.days) {
      const fields = { text: s.title, hour: s.start, duration: s.hours, color };
      if (s.weekly) {
        state.schedule.items.push({ id: uid(), weekday: dow, date: null, from: monday, ...fields });
      } else {
        // The next time that weekday comes round, today included.
        const date = addDays(t, (dow - parseKey(t).getDay() + 7) % 7);
        state.schedule.items.push({ id: uid(), weekday: null, date, ...fields });
      }
      added++;
    }
  }

  chosen('habits').forEach((h, i) => {
    state.habits.items.push({
      id: uid(), name: h.name, emoji: h.emoji, color: COLORS[(i + 3) % COLORS.length], days: h.days,
      goalId: h.goal ? goalFor(h.goal) : '', archived: false, createdAt: now, log: {},
    });
    added++;
  });

  for (const n of chosen('notes')) {
    state.notes.items.unshift({
      id: uid(), title: n.title, body: n.body, color: '', pinned: false, folderId: null, createdAt: now, updatedAt: now,
    });
    added++;
  }

  const boardId = state.vision.boards[0]?.id;
  chosen('vision').forEach((v, i) => {
    state.vision.items.push({ id: uid(), boardId, type: 'quote', text: v.text, caption: '', color: COLORS[i % COLORS.length], createdAt: now });
    added++;
  });

  return added;
}
