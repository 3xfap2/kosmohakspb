import { readFileSync } from 'node:fs';
import { ask } from '../src/engine/assistant';
import { rephraseWithLlm, DEFAULT_LLM } from '../src/engine/llm';
import { evaluatePlan, searchStrategies } from '../src/engine/planner';

const apiKey = readFileSync(process.argv[2], 'utf8').trim();
const model = process.argv[3] ?? DEFAULT_LLM.model;

const plan = searchStrategies({ scenario_id: 'BASE' })[0].plan;
const evaluation = evaluatePlan(plan, { scenario_id: 'BASE', variant: 'base' });
const ctx = {
  scenario_id: 'BASE',
  variant: 'base',
  discounted_cost_mln: evaluation.discounted_cost_mln,
  min_service_total: evaluation.min_service_total,
  feasible: evaluation.feasible,
  failed_constraints: [],
};

const questions = [
  'Что сломает план раньше всего?',
  'Стоит ли нам вкладываться в лунное производство?',
  'Объясни простыми словами, почему в стрессе нужен ZBO',
];

for (const q of questions) {
  const answer = ask(q, { plan, scenario_id: 'BASE', variant: 'base' });
  const t0 = Date.now();
  try {
    const text = await rephraseWithLlm(q, answer, ctx, { ...DEFAULT_LLM, model, apiKey });
    console.log(`\n=== [${model}] ${q}  (${Date.now() - t0} мс)`);
    console.log(text);
  } catch (e) {
    console.log(`\n=== [${model}] ${q} — ОШИБКА: ${(e as Error).message}`);
  }
}
