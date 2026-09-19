/**
 * Генератор сохранённых расчётов: планы, выгрузки, протоколы и сводка.
 * Запуск: npm run results
 * Повторный запуск на тех же данных даёт те же файлы (в вероятностных тестах seed зафиксирован).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { contractsForPlan, totalOverpay } from '../src/engine/contracts';
import { buildExportEnvelope, comparisonCsv, kpiCsv, planJson, toCsv } from '../src/engine/exportData';
import { GEO_PRESETS, assessGeoEvent } from '../src/engine/geopolitics';
import { kpis } from '../src/engine/kpi';
import { PROFILES, compareProfiles, scoreByProfile, weightSensitivity } from '../src/engine/mcda';
import { evaluatePlan, paretoFront, searchStrategies, type Evaluation } from '../src/engine/planner';
import { assessRisk, defaultRiskRegister, monteCarlo, sensitivity } from '../src/engine/risks';
import { buildPlan, enumerateStrategies } from '../src/engine/planner';
import { DECISION_SCENARIOS, robustAnalysis } from '../src/engine/robust';
import { failedConstraintList } from '../src/engine/constraints';
import { adaptationAnalysis, decisionDeadline, reverseStress } from '../src/engine/stressLab';
import type { DemandVariant } from '../src/engine/simulate';

const OUT = 'results';
mkdirSync(OUT, { recursive: true });

const fmt = (v: number, d = 0) => v.toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (v: number, d = 1) => `${fmt(v * 100, d)}%`;
const rows = (data: unknown) => data as unknown as Record<string, unknown>[];

function saveRun(tag: string, scenario_id: string, variant: DemandVariant = 'base') {
  const ranked = searchStrategies({ scenario_id, variant });
  const best = ranked.find((e) => e.feasible) ?? ranked[0];
  const risks = defaultRiskRegister().map((r) => assessRisk(best.plan, scenario_id, r, variant));

  writeFileSync(`${OUT}/plan_${tag}.json`, planJson(best.plan));
  writeFileSync(`${OUT}/kpi_${tag}.csv`, kpiCsv(best));
  writeFileSync(`${OUT}/balance_${tag}.csv`, toCsv(rows(best.result.years)));
  writeFileSync(`${OUT}/sources_${tag}.csv`, toCsv(rows(best.result.sources)));
  writeFileSync(`${OUT}/checks_${tag}.csv`, toCsv(rows(best.checks)));
  writeFileSync(`${OUT}/strategies_${tag}.csv`, comparisonCsv(ranked));
  writeFileSync(`${OUT}/export_${tag}.json`, JSON.stringify(buildExportEnvelope(best, risks), null, 2));

  writeFileSync(
    `${OUT}/risks_${tag}.csv`,
    toCsv(
      risks.map((r) => ({
        scenario_id,
        risk_id: r.risk.risk_id,
        event: r.risk.event,
        cause: r.risk.cause,
        affected_parameter: r.risk.affected_parameter,
        period: r.risk.years.join(' '),
        probability: r.risk.probability,
        probability_basis: r.risk.probability_basis,
        severity: r.risk.severity,
        severity_basis: r.risk.severity_basis,
        dependencies: r.risk.dependencies.join(' '),
        delta_cost_mln: Math.round(r.delta_cost_mln * 10) / 10,
        shortage_t: Math.round(r.shortage_t * 10) / 10,
        min_service_total: Math.round(r.min_service_total * 10000) / 10000,
        constraint_breaks: r.constraint_breaks.join(' '),
        owner: r.risk.owner,
        mitigation: r.risk.mitigation,
        residual: r.residual_note,
        channel_used_by_plan: r.unused_channel ? 'no' : 'yes',
      })),
    ),
  );

  const cards = contractsForPlan(best.plan, best);
  writeFileSync(
    `${OUT}/contracts_${tag}.csv`,
    toCsv(
      cards.map((c) => ({
        scenario_id,
        source_id: c.source_id,
        counterparty: c.counterparty,
        years: c.years,
        ordered_t: Math.round(c.contracted_volume_t * 10) / 10,
        delivered_t: Math.round(c.delivered_t * 10) / 10,
        paid_volume_t: Math.round(c.paid_volume_t * 10) / 10,
        overpaid_t: Math.round(c.overpaid_t * 10) / 10,
        procurement_mln: Math.round(c.procurement_mln * 10) / 10,
        reservation_mln: Math.round(c.reservation_mln * 10) / 10,
        reservation_use: Math.round(c.reservation_use * 1000) / 1000,
        ...Object.fromEntries(c.terms.map((t) => [`${t.label} [${t.status}]`, t.value])),
      })),
    ),
  );

  const mc = monteCarlo(best.plan, scenario_id, { runs: 1000, seed: 42, variant });
  writeFileSync(
    `${OUT}/kpi_targets_${tag}.csv`,
    toCsv(
      kpis(best, mc).map((k) => ({
        scenario_id,
        kpi_id: k.id,
        label: k.label,
        formula: k.formula,
        unit: k.unit,
        actual: Math.round(k.actual * 10000) / 10000,
        target: k.target,
        status: k.status,
        control: k.control,
        source: k.source,
      })),
    ),
  );

  return { ranked, best, risks, mc, cards };
}

const base = saveRun('base', 'BASE');
const stress = saveRun('stress', 'MANDATORY_STRESS');
const low = saveRun('low', 'BASE', 'low');
const high = saveRun('high', 'BASE', 'high');

// --- сравнение сценариев одним файлом ---
const runs = [
  { id: 'BASE', label: 'Стандартный', run: base },
  { id: 'MANDATORY_STRESS', label: 'Обязательный стресс', run: stress },
  { id: 'LOW_DEMAND', label: 'Низкий спрос', run: low },
  { id: 'HIGH_DEMAND', label: 'Высокий спрос', run: high },
];

writeFileSync(
  `${OUT}/scenario_comparison.csv`,
  toCsv(
    runs.map(({ id, label, run }) => ({
      scenario_id: id,
      label,
      strategy: run.best.label,
      feasible: run.best.feasible,
      discounted_cost_mln: Math.round(run.best.discounted_cost_mln),
      total_cost_mln: Math.round(run.best.total_cost_mln),
      capex_mln: Math.round(run.best.capex_mln),
      cost_per_served_t: Math.round(run.best.result.totals.cost_per_served_t * 100) / 100,
      min_service_total: Math.round(run.best.min_service_total * 10000) / 10000,
      min_service_critical: Math.round(run.best.min_service_critical * 10000) / 10000,
      shortage_total_t: Math.round(run.best.shortage_total_t * 10) / 10,
      end_horizon_reserve_days: Math.round(run.best.end_horizon_reserve_days),
      overpaid_t: Math.round(totalOverpay(run.cards).tons * 10) / 10,
      feasible_strategies: run.ranked.filter((e) => e.feasible).length,
      mc_shortage_probability: Math.round(run.mc.p_any_shortage * 1000) / 1000,
    })),
  ),
);

// --- обратный стресс-тест ---
const reverse = reverseStress(base.best.plan, 'BASE');
writeFileSync(
  `${OUT}/reverse_stress_base.csv`,
  toCsv(
    reverse.grid.map((g) => ({
      demand_factor: g.demand_factor,
      price_factor: g.price_factor,
      isru_share_factor: g.isru_share_factor,
      feasible: g.feasible,
      min_service_total: Math.round(g.min_service_total * 10000) / 10000,
      shortage_t: Math.round(g.shortage_t * 10) / 10,
      total_cost_mln: Math.round(g.total_cost_mln),
      failed: g.failed.join(' '),
    })),
  ),
);

// --- адаптация ---
const adaptation = adaptationAnalysis(base.best.plan, { scenario_id: 'MANDATORY_STRESS', learn_year: 2038 });
writeFileSync(
  `${OUT}/adaptation_2038.csv`,
  toCsv(
    [adaptation.baseline, ...adaptation.options].map((o) => ({
      option_id: o.option_id,
      label: o.label,
      first_effective_year: o.first_effective_year ?? '',
      added_volume_t: Math.round(o.added_volume_t * 10) / 10,
      delta_cost_mln: Math.round(o.delta_cost_mln * 10) / 10,
      shortage_after_t: Math.round(o.shortage_after_t * 10) / 10,
      service_after: Math.round(o.service_after * 10000) / 10000,
      feasible: o.feasible,
      failed_constraints: o.failed_constraints,
      note: o.note,
    })),
  ),
);

// --- дедлайн решения ---
const deadline = decisionDeadline(base.best.plan, { scenario_id: 'MANDATORY_STRESS' });
writeFileSync(
  `${OUT}/decision_deadline.csv`,
  toCsv(
    deadline.rows.map((r) => ({
      learn_year: r.learn_year,
      closes_regular: r.closes_regular,
      closes_any: r.closes_any,
      cheapest_label: r.cheapest_label ?? '',
      cheapest_cost_mln: r.cheapest_cost_mln === null ? '' : Math.round(r.cheapest_cost_mln * 10) / 10,
      cheapest_feasible: r.cheapest_label === null ? '' : r.cheapest_feasible,
      cheapest_blocking: r.cheapest_blocking,
      residual_shortage_t: Math.round(r.residual_shortage_t * 10) / 10,
    })),
  ),
);

// --- эффект инвестиционных решений ---
const noInvest = base.ranked.find((e) => e.plan.decisions.investments.length === 0)!;
writeFileSync(
  `${OUT}/investment_effect.csv`,
  toCsv([
    {
      metric: 'discounted_cost_mln',
      no_investment: Math.round(noInvest.discounted_cost_mln),
      chosen: Math.round(base.best.discounted_cost_mln),
      delta: Math.round(base.best.discounted_cost_mln - noInvest.discounted_cost_mln),
    },
    {
      metric: 'total_cost_mln',
      no_investment: Math.round(noInvest.total_cost_mln),
      chosen: Math.round(base.best.total_cost_mln),
      delta: Math.round(base.best.total_cost_mln - noInvest.total_cost_mln),
    },
    {
      metric: 'capex_mln',
      no_investment: Math.round(noInvest.capex_mln),
      chosen: Math.round(base.best.capex_mln),
      delta: Math.round(base.best.capex_mln - noInvest.capex_mln),
    },
    {
      metric: 'cost_per_served_t',
      no_investment: Math.round(noInvest.result.totals.cost_per_served_t * 100) / 100,
      chosen: Math.round(base.best.result.totals.cost_per_served_t * 100) / 100,
      delta: Math.round((base.best.result.totals.cost_per_served_t - noInvest.result.totals.cost_per_served_t) * 100) / 100,
    },
  ]),
);

// --- геополитические сценарии ---
const geo = GEO_PRESETS.map((event) => assessGeoEvent(base.best.plan, 'BASE', event));
writeFileSync(
  `${OUT}/geopolitics.csv`,
  toCsv(
    geo.map((g) => ({
      event_id: g.event.event_id,
      label: g.event.label,
      component: g.event.component,
      sources: g.event.affected_source_ids.join(' '),
      period: `${g.event.from_year}-${g.event.to_year}`,
      magnitude: g.magnitude,
      basis: g.event.basis,
      cost_before_mln: Math.round(g.before.total_cost_mln),
      cost_after_mln: Math.round(g.after.total_cost_mln),
      delta_cost_mln: Math.round(g.delta_cost_mln * 10) / 10,
      range_low_mln: g.range_costs ? Math.round(g.range_costs.low) : '',
      range_high_mln: g.range_costs ? Math.round(g.range_costs.high) : '',
      service_after: Math.round(g.after.min_service_total * 10000) / 10000,
      shortage_after_t: Math.round(g.after.shortage_total_t * 10) / 10,
      skipped_years: g.skipped_years.join(' '),
    })),
  ),
);

// --- робастный выбор ---
const robust = robustAnalysis();
writeFileSync(
  `${OUT}/robust_regret.csv`,
  toCsv(
    robust.rows.map((r) => ({
      strategy: r.strategy,
      ...Object.fromEntries(DECISION_SCENARIOS.map((s) => [`cost_${s.id}`, Math.round(r.costs[s.id])])),
      ...Object.fromEntries(DECISION_SCENARIOS.map((s) => [`feasible_${s.id}`, r.feasible[s.id]])),
      ...Object.fromEntries(
        DECISION_SCENARIOS.map((s) => [`regret_${s.id}`, Number.isFinite(r.regrets[s.id]) ? Math.round(r.regrets[s.id]) : '']),
      ),
      max_regret: Number.isFinite(r.max_regret) ? Math.round(r.max_regret) : 'неисполнима везде',
      feasible_everywhere: r.feasible_everywhere,
    })),
  ),
);

// --- рекомендованный к принятию план ---
// Инвестиционное решение принимается заранее и одно на все условия, поэтому рядом с
// планами, оптимальными для каждого сценария по отдельности, сдаётся и тот, который
// команда рекомендует принять: робастный по минимаксу сожалений.
const recommendedStrategy = enumerateStrategies().find((x) => x.label === robust.best_by_regret?.strategy);
if (recommendedStrategy) {
  const recommendedPlan = buildPlan(recommendedStrategy, { scenario_id: 'BASE' });
  writeFileSync(`${OUT}/plan_recommended.json`, planJson(recommendedPlan));
  writeFileSync(
    `${OUT}/recommended_across_scenarios.csv`,
    toCsv(
      DECISION_SCENARIOS.map((sc) => {
        const plan = buildPlan(recommendedStrategy, { scenario_id: sc.scenario_id, variant: sc.variant });
        const ev = evaluatePlan(plan, { scenario_id: sc.scenario_id, variant: sc.variant });
        return {
          decision_scenario: sc.id,
          scenario_id: sc.scenario_id,
          variant: sc.variant,
          strategy: recommendedStrategy.label,
          discounted_cost_mln: Math.round(ev.discounted_cost_mln),
          total_cost_mln: Math.round(ev.total_cost_mln),
          capex_mln: Math.round(ev.capex_mln),
          min_service_total: Math.round(ev.min_service_total * 10000) / 10000,
          shortage_total_t: Math.round(ev.shortage_total_t * 10) / 10,
          feasible: ev.feasible,
          failed_constraints: failedConstraintList(ev.checks, ev.violations),
        };
      }),
    ),
  );
}

// --- многокритериальный выбор ---
// Берём весь перебор, а не первые строки по стоимости: отбор по расходам выбрасывал
// вариант «Без инвестиций», то есть ровно тот, который важен профилю с максимальным
// весом CAPEX. Неисполнимые строки остаются в таблице с указанной причиной исключения.
const pool = base.ranked;
writeFileSync(
  `${OUT}/mcda_profiles.csv`,
  toCsv(
    PROFILES.flatMap((profile) =>
      scoreByProfile(pool, profile).map((row) => ({
        profile: profile.label,
        weights: Object.entries(profile.weights)
          .map(([k, v]) => `${k}:${v}`)
          .join(' '),
        strategy: row.label,
        score: Math.round(row.score * 1000) / 1000,
        excluded_reason: row.excluded_reason ?? '',
        cost_mln: Math.round(row.raw.cost),
        service: Math.round(row.raw.service * 10000) / 10000,
        capex_mln: Math.round(row.raw.capex),
      })),
    ),
  ),
);

// --- чувствительность ---
writeFileSync(
  `${OUT}/sensitivity_base.csv`,
  toCsv(
    (['demand', 'price_earth', 'isru_delivery'] as const).flatMap((param) =>
      sensitivity(base.best.plan, 'BASE', param).map((p) => ({
        parameter: param,
        factor: p.factor,
        total_cost_mln: Math.round(p.total_cost_mln),
        min_service_total: Math.round(p.min_service_total * 10000) / 10000,
        feasible: p.feasible,
        failed_constraints: p.failed_constraints,
      })),
    ),
  ),
);

// Разбивка причин отсева в стрессе: считаем, а не утверждаем
const stressFailed = stress.ranked.filter((e) => !e.feasible);
const failedText = (e: Evaluation) => failedConstraintList(e.checks, e.violations);
const stressReasons = {
  loss: stressFailed.filter((e) => failedText(e).includes('STRESS_LOSS_LIMIT') && !failedText(e).includes('RESERVE_45D')).length,
  both: stressFailed.filter((e) => failedText(e).includes('STRESS_LOSS_LIMIT') && failedText(e).includes('RESERVE_45D')).length,
  reserveOnly: stressFailed.filter((e) => !failedText(e).includes('STRESS_LOSS_LIMIT') && failedText(e).includes('RESERVE_45D')).length,
  reserveOnlyLabels: stressFailed
    .filter((e) => !failedText(e).includes('STRESS_LOSS_LIMIT') && failedText(e).includes('RESERVE_45D'))
    .map((e) => e.label)
    .join(', '),
};

// --- сводка ---
const row = (e: Evaluation) =>
  `| ${e.label} | ${e.feasible ? 'да' : 'нет'} | ${fmt(e.discounted_cost_mln)} | ${fmt(e.total_cost_mln)} | ${fmt(e.capex_mln)} | ${pct(e.min_service_total)} | ${fmt(e.end_horizon_reserve_days)} |`;

const fixedPlanInStress = evaluatePlan(base.best.plan, { scenario_id: 'MANDATORY_STRESS', label: base.best.label });
const fixedPlanInBase = evaluatePlan(stress.best.plan, { scenario_id: 'BASE', label: stress.best.label });
const reasons = (e: Evaluation) =>
  [
    ...e.checks.filter((c) => !c.passed && c.role === 'hard').map((c) => `${c.constraint_id}${c.year ? ` ${c.year}` : ''}`),
    ...new Set(e.violations.map((v) => v.code)),
  ]
    .slice(0, 4)
    .join(', ') || 'нарушений нет';

const profileChoice = compareProfiles(pool);
const weightRows = weightSensitivity(pool, PROFILES[0]).filter((r) => r.changed);

const summary = `# Сводка расчётов

Файл создаётся командой \`npm run results\`. Числа совпадают с интерфейсом и выгрузками этой же папки.

## Сценарии на одной базе

| Сценарий | Стратегия | Приведённые | Итого | CAPEX | Мин. сервис | Дефицит | Запас 2040 |
|---|---|---|---|---|---|---|---|
${runs
  .map(
    ({ label, run }) =>
      `| ${label} | ${run.best.label} | ${fmt(run.best.discounted_cost_mln)} | ${fmt(run.best.total_cost_mln)} | ${fmt(run.best.capex_mln)} | ${pct(run.best.min_service_total)} | ${fmt(run.best.shortage_total_t, 1)} т | ${fmt(run.best.end_horizon_reserve_days)} дн |`,
  )
  .join('\n')}

Исполнимых стратегий: стандартный ${base.ranked.filter((e) => e.feasible).length} из ${base.ranked.length}, стресс ${stress.ranked.filter((e) => e.feasible).length} из ${stress.ranked.length}. Причины отсева в стрессе: ${stressReasons.loss} стратегий — предел потерь 2% с 2038 года (без ZBO-модернизации потери 4,5% от оборота), ${stressReasons.both} — предел потерь вместе с 45-дневным резервом, ${stressReasons.reserveOnly} — только резерв (${stressReasons.reserveOnlyLabels}): модернизация у них есть, но плана она не спасает.

Первые пять стратегий стандартного сценария:

| Стратегия | Исполнима | Приведённые | Итого | CAPEX | Мин. сервис | Запас 2040, дней |
|---|---|---|---|---|---|---|
${base.ranked.slice(0, 5).map(row).join('\n')}

Фронт Парето стандартного сценария: ${paretoFront(base.ranked.filter((e) => e.feasible)).length} стратегий.

## Единое решение для всех условий

Инвестиции принимаются заранее, объёмы подстраиваются под сценарий. Минимакс сожалений по четырём сценариям решения:

- робастный выбор: **${robust.best_by_regret?.strategy ?? '—'}**, максимальное сожаление ${robust.best_by_regret ? fmt(robust.best_by_regret.max_regret) : '—'} млн у.е.;
- дешевле всего в стандартных условиях: ${robust.cheapest_in_base?.strategy ?? '—'} (${robust.cheapest_in_base?.feasible_everywhere ? 'исполнима везде' : 'ломается в других сценариях'});
- плата за устойчивость: ${fmt(robust.price_of_robustness_mln)} млн у.е. приведённых расходов.

Один и тот же план поставок в обоих сценариях не работает:

| Что проверяем | Результат | Нарушения |
|---|---|---|
| План стандартного сценария в стрессе | сервис ${pct(fixedPlanInStress.min_service_total)}, дефицит ${fmt(fixedPlanInStress.shortage_total_t, 1)} т | ${reasons(fixedPlanInStress)} |
| План стресса в стандартных условиях | сервис ${pct(fixedPlanInBase.min_service_total)}, дефицит ${fmt(fixedPlanInBase.shortage_total_t, 1)} т | ${reasons(fixedPlanInBase)} |

## Что рекомендуется принять

В results/ лежат три плана, и они отвечают на разные вопросы — их нельзя путать:

| Файл | Что это | Инвестиции |
|---|---|---|
| plan_base.json | самый дешёвый план, если реализуются стандартные условия | ${base.best.label} |
| plan_stress.json | самый дешёвый план, если реализуется обязательный стресс | ${stress.best.label} |
| plan_recommended.json | **то, что команда рекомендует принять**: инвестиции выбраны по минимаксу сожалений и не зависят от того, какой сценарий реализуется | ${robust.best_by_regret?.strategy ?? '—'} |

Первые два плана показывают, как условия сдвигают оптимум, и взаимно исключают друг друга по
инвестициям: в одном финансируется лунное производство, в другом вместо него исполняется опцион
Earth-New. Выбрать оба оператор не может. Поэтому к принятию предлагается третий: он исполним во всех
четырёх сценариях решения, а плата за это — ${fmt(robust.price_of_robustness_mln)} млн у.е. приведённых расходов относительно
самого дешёвого варианта стандартного сценария. Поведение рекомендованного плана по сценариям —
в results/recommended_across_scenarios.csv.

## Граница прочности плана стандартного сценария

- рост спроса: ${reverse.thresholds.demand_only ? `+${fmt((reverse.thresholds.demand_only - 1) * 100)}%` : 'в диапазоне не ломает'};
- рост цены земных каналов: ${reverse.thresholds.price_only ? `+${fmt((reverse.thresholds.price_only - 1) * 100)}%` : 'в диапазоне не ломает'};
- падение поставки ISRU: ${reverse.thresholds.isru_only ? `−${fmt((1 - reverse.thresholds.isru_only) * 100)}%` : 'в диапазоне не ломает'};
- проверено сочетаний: ${reverse.grid.length}, из них ломают план ${reverse.grid.filter((g) => !g.feasible).length}.

## Цена адаптации, если ухудшение видно в начале 2038 года

| Вариант | Реакция с | Добрано, т | Δ расходов, млн | Дефицит после | Сервис после | Проходит ограничения |
|---|---|---|---|---|---|---|
${[adaptation.baseline, ...adaptation.options]
  .map(
    (o) =>
      `| ${o.label} | ${o.first_effective_year ?? '—'} | ${fmt(o.added_volume_t, 1)} | ${fmt(o.delta_cost_mln, 1)} | ${fmt(o.shortage_after_t, 1)} т | ${pct(o.service_after)} | ${o.feasible ? 'да' : `нет: ${o.failed_constraints}`} |`,
  )
  .join('\n')}

## Дедлайн решения

Тот же расчёт адаптации прогнан по всем годам горизонта. Дефицит без реакции — ${fmt(deadline.baseline_shortage_t, 1)} т.

| Узнали в начале | Штатные каналы | Любой канал | Чем закрывается дешевле всего | Цена, млн | Проходит ограничения | Остаток дефицита, т |
|---|---|---|---|---|---|---|
${deadline.rows
  .map(
    (r) =>
      `| ${r.learn_year} года | ${r.closes_regular ? 'закрывают' : 'не закрывают'} | ${r.closes_any ? 'закрывает' : 'не закрывает'} | ${r.cheapest_label ?? '—'} | ${r.cheapest_cost_mln === null ? '—' : fmt(r.cheapest_cost_mln, 0)} | ${r.cheapest_label === null ? '—' : r.cheapest_feasible ? 'да' : `нет: ${r.cheapest_blocking}`} | ${fmt(r.residual_shortage_t, 1)} |`,
  )
  .join('\n')}

Штатными каналами: ${deadline.last_regular_year ? `последний год реакции — ${deadline.last_regular_year}` : 'дефицит не закрывается ни в один год'}. С аварийным каналом выдача закрывается ${deadline.last_any_year ? `до ${deadline.last_any_year} года включительно` : 'не закрывается'}, но план при этом ${deadline.last_feasible_year ? `остаётся исполнимым до ${deadline.last_feasible_year} года` : 'жёсткие ограничения всё равно не проходит: аварийный канал закрывает выдачу, но не восстанавливает 45-дневный резерв'}.

## Эффект инвестиционных решений

Нижняя граница для сравнения — стратегия «Без инвестиций» в стандартном сценарии.

| Показатель | Без инвестиций | Выбранный план | Разница |
|---|---|---|---|
| Приведённые расходы, млн у.е. | ${fmt(noInvest.discounted_cost_mln)} | ${fmt(base.best.discounted_cost_mln)} | ${fmt(base.best.discounted_cost_mln - noInvest.discounted_cost_mln)} |
| Полные расходы, млн у.е. | ${fmt(noInvest.total_cost_mln)} | ${fmt(base.best.total_cost_mln)} | ${fmt(base.best.total_cost_mln - noInvest.total_cost_mln)} |
| CAPEX, млн у.е. | ${fmt(noInvest.capex_mln)} | ${fmt(base.best.capex_mln)} | ${fmt(base.best.capex_mln - noInvest.capex_mln)} |
| Тонна обслуженного спроса, млн у.е. | ${fmt(noInvest.result.totals.cost_per_served_t, 2)} | ${fmt(base.best.result.totals.cost_per_served_t, 2)} | ${fmt(base.best.result.totals.cost_per_served_t - noInvest.result.totals.cost_per_served_t, 2)} |

## Монте-Карло по отказам каналов

| Сценарий | Прогонов | Seed | P(дефицит) | Точность, ±п.п. | P(сервис < 97%) | Средний дефицит | 95-й процентиль |
|---|---|---|---|---|---|---|---|
${runs
  .map(
    ({ label, run }) =>
      `| ${label} | ${run.mc.runs} | ${run.mc.seed} | ${pct(run.mc.p_any_shortage)} | ±${fmt(1.96 * run.mc.p_any_shortage_se * 100, 1)} | ${pct(run.mc.p_service_below_target)} | ${fmt(run.mc.mean_shortage_t, 1)} т | ${fmt(run.mc.p95_shortage_t, 1)} т |`,
  )
  .join('\n')}

Оценка точности — стандартная ошибка доли sqrt(p(1-p)/n), умноженная на 1,96. При 1 000 прогонов это
примерно ±2,6 п.п., поэтому различие вероятностей между сценариями внутри этого интервала
статистически неразличимо и содержательно не интерпретируется.

## Геополитические сценарии на копии набора

| Событие | Что меняется | Период | Величина | Δ расходов | Диапазон | Сервис после |
|---|---|---|---|---|---|---|
${geo
  .map(
    (g) =>
      `| ${g.event.label} | ${g.event.component} | ${g.event.from_year}–${g.event.to_year} | ${pct(g.magnitude, 0)} | ${fmt(g.delta_cost_mln, 1)} млн | ${g.range_costs ? `${fmt(g.range_costs.low)}–${fmt(g.range_costs.high)} млн` : '—'} | ${pct(g.after.min_service_total)} |`,
  )
  .join('\n')}

## Интересы сторон

| Сторона | Предпочитает | Следующий вариант | Отрыв |
|---|---|---|---|
${profileChoice.map((c) => `| ${c.profile.label} | ${c.top?.label ?? '—'} | ${c.runnerUp?.label ?? '—'} | ${c.gap ? fmt(c.gap, 3) : '—'} |`).join('\n')}

Устойчивость выбора оператора к сдвигу весов на 15 процентных пунктов: ${weightRows.length === 0 ? 'лидер не меняется ни при одном сдвиге' : `меняется в ${weightRows.length} ${weightRows.length === 1 ? 'случае' : 'случаях'} (${weightRows.map((r) => r.label).join(', ')})`}.

## Договоры и переплата

| Канал | Заказано | Поставлено | Оплачено | Оплачено сверх полученного | Платежи, млн |
|---|---|---|---|---|---|
${base.cards
  .map(
    (c) =>
      `| ${c.name} | ${fmt(c.contracted_volume_t, 1)} т | ${fmt(c.delivered_t, 1)} т | ${fmt(c.paid_volume_t, 1)} т | ${fmt(c.overpaid_t, 1)} т | ${fmt(c.procurement_mln + c.reservation_mln, 1)} |`,
  )
  .join('\n')}

Итого оплачено сверх фактически полученного: ${fmt(totalOverpay(base.cards).tons, 1)} т в стандартном сценарии и ${fmt(totalOverpay(stress.cards).tons, 1)} т в стрессе.

## KPI плана стандартного сценария

| Показатель | Факт | Цель | Статус |
|---|---|---|---|
${kpis(base.best, base.mc)
  .map((k) => `| ${k.label} | ${k.unit === 'доля' ? pct(k.actual) : fmt(k.actual, 2)} ${k.unit === 'доля' ? '' : k.unit} | ${k.target} | ${k.status} |`)
  .join('\n')}
`;

writeFileSync(`${OUT}/summary.md`, summary);
console.log(summary.slice(0, 2600));
console.log('\n--- файлы записаны в results/');
