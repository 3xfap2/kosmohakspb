import { useEffect, useMemo } from 'react';
import { CASE } from '../engine/caseData';
import { searchStrategies } from '../engine/planner';
import { Mark } from './Mark';
import { fmt, fmtPct } from './theme';

function useReveal() {
  useEffect(() => {
    const nodes = document.querySelectorAll('.reveal');
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('shown')),
      { threshold: 0.15 },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
}

/** Орбитальная схема: узел в центре, кольца поставок вокруг. */
function Orbit() {
  return (
    <div className="lp-orbit" aria-hidden="true">
      <svg viewBox="0 0 520 520">
        <defs>
          <radialGradient id="core" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#cbfffc" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#00827c" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#011d1c" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#cbfffc" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#00827c" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        <circle cx="260" cy="260" r="235" className="ring" />
        <circle cx="260" cy="260" r="186" className="ring dashed" />
        <circle cx="260" cy="260" r="138" className="ring" />
        <circle cx="260" cy="260" r="92" className="ring dashed" />
        <circle cx="260" cy="260" r="150" fill="url(#core)" />

        <g className="orbit-spin">
          <circle cx="260" cy="25" r="5" fill="#cbfffc" />
          <path d="M 260 25 A 235 235 0 0 1 460 150" stroke="url(#arc)" strokeWidth="2" fill="none" />
        </g>
        <g className="orbit-spin reverse">
          <circle cx="260" cy="74" r="4" fill="#7ef0d0" />
          <circle cx="446" cy="260" r="3" fill="#bbc7c6" opacity="0.8" />
        </g>
        <g className="orbit-spin" style={{ animationDuration: '30s' }}>
          <circle cx="260" cy="122" r="3.5" fill="#cbfffc" opacity="0.85" />
        </g>
      </svg>
    </div>
  );
}

export function Landing({ onEnter }: { onEnter: () => void }) {
  useReveal();

  const best = useMemo(() => {
    const ranked = searchStrategies({ scenario_id: 'BASE' });
    return ranked.find((e) => e.feasible) ?? ranked[0];
  }, []);

  const channels = CASE.sources.map((s) => ({
    id: s.source_id,
    name: s.name,
    volume: best.result.sources.filter((r) => r.source_id === s.source_id).reduce((sum, r) => sum + r.delivered_t, 0),
  }));
  const max = Math.max(...channels.map((c) => c.volume), 1);
  const lastYear = CASE.demand.at(-1)!;

  return (
    <div className="lp">
      <div className="lp-orb one" />
      <div className="lp-orb two" />

      <div className="lp-inner">
        <nav className="lp-nav">
          <div className="lp-logo">
            <Mark />
            Космоконтур
          </div>
          <div className="lp-nav-links">
            <a href="#what">Возможности</a>
            <a href="#how">Как работает</a>
            <a href="#numbers">Цифры кейса</a>
            <button className="lp-btn" onClick={onEnter}>
              Войти в контур
            </button>
          </div>
        </nav>

        <section className="lp-hero">
          <div>
            <span className="lp-badge">
              <b>2035–2040</b> цислунарная транспортная система
            </span>
            <h1 className="lp-h1">
              Топливо на орбите
              <br />
              <em>под полным контролем</em>
            </h1>
            <p className="lp-sub">
              Оператор задаёт поставки, резервы и инвестиции — контур считает материальный баланс по месяцам,
              экономику, риски и проверяет каждое ограничение кейса. Без предположений на словах.
            </p>

            <div className="lp-cta">
              <button className="lp-btn" onClick={onEnter}>
                Открыть рабочее место →
              </button>
              <button className="lp-btn secondary" onClick={onEnter}>
                Войти как гость
              </button>
            </div>

            <div className="lp-trust">
              <span>
                <i /> 115 автотестов, включая контрольные примеры организатора
              </span>
              <span>
                <i /> расчёт в браузере, без ключей и внешних сервисов
              </span>
            </div>
          </div>

          <div className="lp-visual">
            <Orbit />
            <div className="lp-card reveal shown">
              <div className="lp-card-head">
                <span>План снабжения · {best.label}</span>
                <span className="lp-chip">исполним</span>
              </div>
              <div className="lp-card-rows">
                {channels.map((c) => (
                  <div className="lp-card-row" key={c.id}>
                    <span>{c.name}</span>
                    <span className="bar">
                      <i style={{ width: `${Math.max(2, (c.volume / max) * 100)}%` }} />
                    </span>
                    <span className="val">{fmt(c.volume)} т</span>
                  </div>
                ))}
              </div>
              <div className="lp-card-foot">
                <span>Приведённые расходы</span>
                <b style={{ color: 'var(--mint)' }}>{fmt(best.discounted_cost_mln)} млн у.е.</b>
              </div>
              <div className="lp-card-foot" style={{ borderTop: 0, paddingTop: 0, marginTop: 6 }}>
                <span>Обслуживание спроса</span>
                <b style={{ color: 'var(--ok)' }}>{fmtPct(best.min_service_total, 1)}</b>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-section" id="what">
          <div className="lp-kicker">Возможности</div>
          <h2 className="lp-h2">Всё, что оператор проверяет перед подписью контракта</h2>

          <div className="lp-bento">
            <article className="lp-tile wide reveal">
              <div className="lp-tile-glow" />
              <h3>Материальный баланс по месяцам</h3>
              <p>
                Шаг расчёта — месяц: видно внутригодовой провал запаса, переполнение узла и момент, когда
                шестинедельная аварийная поставка уже не успевает.
              </p>
            </article>

            <article className="lp-tile tall reveal">
              <div className="lp-tile-glow" />
              <h3>Контракты как они есть</h3>
              <p>
                Take-or-pay, плата за резервирование и опционы считаются раздельно. Заказ, фактическая поставка и
                выданный объём никогда не складываются в одну цифру.
              </p>
            </article>

            <article className="lp-tile reveal">
              <div className="num">36</div>
              <p>инвестиционных стратегий перебираются на одной базе данных с фронтом Парето</p>
            </article>

            <article className="lp-tile reveal">
              <div className="num">+5%</div>
              <p>роста спроса уже ломает план — граница прочности находится автоматически</p>
            </article>

            <article className="lp-tile reveal">
              <h3>Риски с ценой</h3>
              <p>Событие накладывается на план и пересчитывается: ущерб в тоннах, деньгах и уровне обслуживания.</p>
            </article>

            <article className="lp-tile reveal">
              <div className="lp-tile-glow" />
              <h3>Ассистент, который считает</h3>
              <p>
                Вопрос на русском запускает расчёт в движке и показывает, каким модулем получен ответ. Числа приходят
                из модели, а не из текста.
              </p>
            </article>

            <article className="lp-tile reveal">
              <h3>Интересы сторон</h3>
              <p>
                Пять профилей с раскрытыми весами. Провал критического сервиса исключает вариант при любых весах —
                снижением веса пострадавшего оценку не улучшить.
              </p>
            </article>

            <article className="lp-tile reveal">
              <h3>Выгрузки и повтор</h3>
              <p>CSV и JSON по схемам организатора, план открывается обратно и даёт тот же результат.</p>
            </article>
          </div>
        </section>

        <section className="lp-section" id="how">
          <div className="lp-kicker">Как работает</div>
          <h2 className="lp-h2">От решения оператора до проверенного плана</h2>

          <div className="lp-steps">
            <div className="lp-step reveal">
              <h4>Задаёте решения</h4>
              <p>Объёмы по пяти каналам, резервирование мощности, инвестиции и начальный запас — прямо в таблице.</p>
            </div>
            <div className="lp-step reveal">
              <h4>Контур считает</h4>
              <p>Баланс, потери, платежи, приведённые расходы и обслуживание критического спроса по каждому году.</p>
            </div>
            <div className="lp-step reveal">
              <h4>Проверяете на прочность</h4>
              <p>Обязательный стресс, граница прочности, цена адаптации, условное геополитическое событие.</p>
            </div>
            <div className="lp-step reveal">
              <h4>Выгружаете результат</h4>
              <p>CSV и JSON по схемам организатора, план сохраняется и открывается обратно без потерь.</p>
            </div>
          </div>
        </section>

        <section className="lp-section" id="numbers">
          <div className="lp-kicker">Цифры кейса</div>
          <div className="lp-bento" style={{ marginTop: 28 }}>
            <article className="lp-tile reveal">
              <div className="num">{fmt(lastYear.base_total_t)} т</div>
              <p>спрос 2040 года, из них {fmt(lastYear.base_critical_t)} т критического</p>
            </article>
            <article className="lp-tile reveal">
              <div className="num">{CASE.sources.length}</div>
              <p>канала снабжения: от долгосрочного земного до лунного производства</p>
            </article>
            <article className="lp-tile reveal">
              <div className="num">{CASE.constraints.length}</div>
              <p>жёстких ограничений: сервис, CAPEX, резерв, роль аварийного канала</p>
            </article>
            <article className="lp-tile reveal">
              <div className="num">45</div>
              <p>дней спроса — обязательный резерв на начало каждого года</p>
            </article>
            <article className="lp-tile reveal">
              <div className="num">2</div>
              <p>сценария доступны с первого экрана: стандартный и обязательный стресс</p>
            </article>
            <article className="lp-tile reveal">
              <div className="num">1 250</div>
              <p>млн у.е. стоит лунный проект — контур показывает, когда он окупается, а когда нет</p>
            </article>
          </div>
        </section>

        <section className="lp-final reveal">
          <h2>Откройте контур и проверьте план на прочность</h2>
          <p>
            Гостевой доступ открывает все расчёты без регистрации. Планы хранятся в браузере, данные никуда не
            уходят.
          </p>
          <button className="lp-btn" onClick={onEnter}>
            Открыть рабочее место →
          </button>
        </section>

        <footer className="lp-footer">
          <span>Космоконтур · прототип планирования, не система управления оборудованием</span>
          <span>КосмоХакатон 2026 · кейс «Топливный космоконтур 2035»</span>
        </footer>
      </div>
    </div>
  );
}
