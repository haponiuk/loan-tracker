import {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {hasSupabaseConfig, supabase} from './supabase.js';
import './style.css';

function LoanTrackerApp() {
    const {addDebtor, debtors, error, isLoading} = useDebtors();

    if (isLoading) {
        return <StatusScreen title="Завантажую дані" text="Підключаюся до Supabase." />;
    }

    if (error) {
        return (
            <StatusScreen
                title="Не вдалося завантажити дані"
                text={`${error.message}. Перевір Supabase URL, publishable key і таблиці.`}
            />
        );
    }

    return <LoanDashboard debtors={debtors} onAddDebtor={addDebtor} />;
}

function useDebtors() {
    const [debtors, setDebtors] = useState([]);
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

        async function loadDebtors() {
            try {
                if (!hasSupabaseConfig) {
                    throw new Error('Не задані Supabase env-змінні');
                }

                const payload = await fetchDebtorsFromSupabase();
                if (isMounted) {
                    setDebtors(attachRatings(payload.debtors || []));
                    setError(null);
                }
            } catch (requestError) {
                if (isMounted) {
                    setError(requestError);
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        }

        loadDebtors();

        return () => {
            isMounted = false;
        };
    }, []);

    async function addDebtor(input) {
        const createdDebtor = await createDebtor(input);
        setDebtors(currentDebtors => attachRatings([...currentDebtors, createdDebtor]));
        return createdDebtor;
    }

    return {addDebtor, debtors, error, isLoading};
}

async function fetchDebtorsFromSupabase() {
    const [debtorsResponse, loansResponse, repaymentsResponse] = await Promise.all([
        supabase
            .from('debtors')
            .select('id, full_name, first_name, last_name, borrowed, repaid, remaining, photo_url')
            .order('remaining', {ascending: false})
            .order('full_name', {ascending: true}),
        supabase
            .from('loans')
            .select('id, debtor_id, amount, loan_date, due_date, notes, files')
            .order('loan_date', {ascending: false, nullsFirst: false})
            .order('id', {ascending: false}),
        supabase
            .from('repayments')
            .select('id, debtor_id, amount, repayment_date')
            .order('repayment_date', {ascending: false, nullsFirst: false})
            .order('id', {ascending: false}),
    ]);

    const error = debtorsResponse.error || loansResponse.error || repaymentsResponse.error;

    if (error) {
        throw new Error(error.message);
    }

    const loansByDebtor = groupByDebtor(loansResponse.data || [], row => ({
        id: row.id,
        amount: toNumber(row.amount),
        date: row.loan_date,
        dueDate: row.due_date,
        notes: row.notes || '',
        files: normalizeFiles(row.files),
    }));
    const repaymentsByDebtor = groupByDebtor(repaymentsResponse.data || [], row => ({
        id: row.id,
        amount: toNumber(row.amount),
        date: row.repayment_date,
    }));

    return {
        debtors: (debtorsResponse.data || []).map(row => ({
            id: row.id,
            name: row.full_name,
            firstName: row.first_name || '',
            lastName: row.last_name || '',
            borrowed: toNumber(row.borrowed),
            repaid: toNumber(row.repaid),
            remaining: toNumber(row.remaining),
            photoUrl: row.photo_url,
            loans: loansByDebtor.get(row.id) || [],
            repayments: repaymentsByDebtor.get(row.id) || [],
        })),
    };
}

async function createDebtor(input) {
    const response = await fetch('/api/debtors', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(input),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload.error || 'Не вдалося додати людину');
    }

    return payload.debtor;
}

function LoanDashboard({debtors, onAddDebtor}) {
    const [isAddPersonOpen, setIsAddPersonOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRecordId, setSelectedRecordId] = useState(null);

    const filteredDebtors = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();
        const visible = normalizedSearch
            ? debtors.filter(debtor => debtor.name.toLowerCase().includes(normalizedSearch))
            : debtors;

        return [...visible].sort((a, b) => b.remaining - a.remaining);
    }, [debtors, searchTerm]);

    const selectedDebtor =
        debtors.find(debtor => debtor.id === selectedRecordId) ?? filteredDebtors[0] ?? debtors[0];

    return (
        <main className="loan-shell">
            <aside className="people-panel">
                <section className="panel-header">
                    <div>
                        <p className="eyebrow">Finance</p>
                        <h1>Хлопці</h1>
                    </div>
                    <button
                        aria-label="Додати людину"
                        className="add-person-button"
                        onClick={() => setIsAddPersonOpen(true)}
                        type="button"
                    >
                        <span aria-hidden="true">+</span>
                        Додати людину
                    </button>
                </section>

                <section className="summary-strip" aria-label="Загальна статистика">
                    <MetricTile label="Борг" value={formatMoney(sumBy(debtors, 'remaining'))} />
                    <MetricTile label="Позичено" value={formatMoney(sumBy(debtors, 'borrowed'))} />
                    <MetricTile label="Повернено" value={formatMoney(sumBy(debtors, 'repaid'))} />
                </section>

                <section className="toolbar" aria-label="Пошук">
                    <label className="search-box">
                        <span aria-hidden="true">⌕</span>
                        <input
                            value={searchTerm}
                            onChange={event => setSearchTerm(event.target.value)}
                            placeholder="Пошук..."
                        />
                    </label>
                </section>

                <section className="people-list" aria-label="Список боржників">
                    {filteredDebtors.map(debtor => (
                        <button
                            key={debtor.id}
                            className={`person-row ${
                                selectedDebtor?.id === debtor.id ? 'selected' : ''
                            }`}
                            onClick={() => setSelectedRecordId(debtor.id)}
                            type="button"
                        >
                            <Avatar debtor={debtor} />
                            <span className="person-copy">
                                <strong>{debtor.name}</strong>
                                <span className="money-value">{formatMoney(debtor.remaining)}</span>
                            </span>
                            <span className={debtor.remaining > 0 ? 'status-dot due' : 'status-dot'} />
                        </button>
                    ))}
                    {filteredDebtors.length === 0 ? (
                        <div className="empty-state">
                            <strong>Немає збігів</strong>
                            <span>Спробуй інший пошук.</span>
                        </div>
                    ) : null}
                </section>
            </aside>

            <section className="detail-panel">
                {selectedDebtor ? <DebtorDetail debtor={selectedDebtor} /> : <NoDebtors />}
            </section>

            {isAddPersonOpen ? (
                <AddPersonDialog
                    onClose={() => setIsAddPersonOpen(false)}
                    onCreate={async formValues => {
                        const createdDebtor = await onAddDebtor(formValues);
                        setSelectedRecordId(createdDebtor.id);
                        setSearchTerm('');
                        setIsAddPersonOpen(false);
                    }}
                />
            ) : null}
        </main>
    );
}

function AddPersonDialog({onClose, onCreate}) {
    const [error, setError] = useState('');
    const [formValues, setFormValues] = useState({
        firstName: '',
        lastName: '',
        photoUrl: '',
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function handleSubmit(event) {
        event.preventDefault();
        setError('');

        if (!formValues.firstName.trim() && !formValues.lastName.trim()) {
            setError('Вкажи хоча б імʼя або прізвище.');
            return;
        }

        setIsSubmitting(true);

        try {
            await onCreate(formValues);
        } catch (submitError) {
            setError(submitError.message);
        } finally {
            setIsSubmitting(false);
        }
    }

    function updateField(fieldName, value) {
        setFormValues(currentValues => ({
            ...currentValues,
            [fieldName]: value,
        }));
    }

    return (
        <div className="dialog-backdrop" role="presentation">
            <form className="person-dialog" onSubmit={handleSubmit}>
                <div className="dialog-head">
                    <div>
                        <p className="eyebrow">Новий боржник</p>
                        <h2>Додати людину</h2>
                    </div>
                    <button aria-label="Закрити" className="icon-button" onClick={onClose} type="button">
                        ×
                    </button>
                </div>

                <div className="form-grid">
                    <label>
                        <span>Імʼя</span>
                        <input
                            autoFocus
                            onChange={event => updateField('firstName', event.target.value)}
                            placeholder="Віталій"
                            value={formValues.firstName}
                        />
                    </label>
                    <label>
                        <span>Прізвище</span>
                        <input
                            onChange={event => updateField('lastName', event.target.value)}
                            placeholder="Тарківський"
                            value={formValues.lastName}
                        />
                    </label>
                    <label className="wide-field">
                        <span>Фото URL</span>
                        <input
                            onChange={event => updateField('photoUrl', event.target.value)}
                            placeholder="https://..."
                            value={formValues.photoUrl}
                        />
                    </label>
                </div>

                {error ? <div className="form-error">{error}</div> : null}

                <div className="dialog-actions">
                    <button className="secondary-button" onClick={onClose} type="button">
                        Скасувати
                    </button>
                    <button className="primary-button" disabled={isSubmitting} type="submit">
                        {isSubmitting ? 'Додаю...' : 'Додати'}
                    </button>
                </div>
            </form>
        </div>
    );
}

function DebtorDetail({debtor}) {
    const rating = debtor.rating;

    return (
        <article className="debtor-detail">
            <header className="detail-hero">
                <div>
                    <p className="eyebrow">Профіль боржника</p>
                    <h2>{debtor.name}</h2>
                </div>
                <RatingBadge rating={rating} />
            </header>

            <section className="profile-grid">
                <div className="photo-card">
                    {debtor.photoUrl ? (
                        <img src={debtor.photoUrl} alt={debtor.name} />
                    ) : (
                        <div className="photo-placeholder">{getInitials(debtor.name)}</div>
                    )}
                </div>

                <div className="ledger-card">
                    <MetricRow label="Загалом Позичив" value={formatMoney(debtor.borrowed)} />
                    <MetricRow label="Загалом Повернув" value={formatMoney(debtor.repaid)} />
                    <MetricRow label="Активний борг" value={formatMoney(debtor.remaining)} accent />
                </div>
            </section>

            <section className="activity-grid">
                <ActivityList
                    title="Позики"
                    emptyLabel="Позик ще немає"
                    items={debtor.loans}
                    amountKey="amount"
                    dateKey="date"
                    noteKey="notes"
                />
                <ActivityList
                    title="Повернення"
                    emptyLabel="Повернень ще немає"
                    items={debtor.repayments}
                    amountKey="amount"
                    dateKey="date"
                />
            </section>

            <RatingSection rating={rating} />
        </article>
    );
}

function RatingBadge({rating}) {
    return (
        <div className={`rating-badge rating-${rating.tone}`}>
            <div className="rating-badge-copy">
                <span>Рейтинг</span>
                <strong>{rating.score}</strong>
                <em>{rating.label}</em>
            </div>
            <RatingIcon tone={rating.tone} />
            <div className="rating-meter" aria-hidden="true">
                <span style={{width: `${rating.score}%`}} />
            </div>
        </div>
    );
}

function RatingSection({rating}) {
    return (
        <section className="rating-section" aria-label="Розрахунок рейтингу боржника">
            <div className="rating-head">
                <div>
                    <p className="eyebrow">Розрахунок</p>
                    <h3>Рейтинг боржника</h3>
                </div>
                <div className={`rating-score-card rating-${rating.tone}`}>
                    <div>
                        <span>Загальний бал</span>
                        <strong>{rating.score}/100</strong>
                        <em>{rating.label}</em>
                    </div>
                    <RatingIcon tone={rating.tone} />
                </div>
            </div>

            <div className="rating-grid">
                {rating.factors.map(factor => (
                    <div className="rating-factor" key={factor.key}>
                        <div>
                            <span>{factor.label}</span>
                            <strong>{factor.value}</strong>
                        </div>
                        <div className="rating-bar" aria-hidden="true">
                            <span style={{width: `${factor.score}%`}} />
                        </div>
                        <p>{factor.note}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}

function RatingIcon({tone}) {
    const iconMark = tone === 'good' ? '✓' : '!';

    return (
        <span className={`rating-icon rating-${tone}`} aria-hidden="true">
            <svg viewBox="0 0 42 46" role="img" focusable="false">
                <path d="M21 2 37 8v13c0 10.8-6.5 18.4-16 22-9.5-3.6-16-11.2-16-22V8l16-6Z" />
            </svg>
            <span>{iconMark}</span>
        </span>
    );
}

function ActivityList({title, emptyLabel, items, amountKey, dateKey, noteKey}) {
    return (
        <div className="activity-card">
            <div className="activity-title">
                <h3>{title}</h3>
                <span>{items.length}</span>
            </div>
            {items.length === 0 ? (
                <div className="muted-empty">{emptyLabel}</div>
            ) : (
                <div className="activity-list">
                    {items.map(item => (
                        <div className="activity-row" key={item.id}>
                            <div>
                                <strong className="money-value">{formatMoney(item[amountKey])}</strong>
                                <span>{formatDate(item[dateKey])}</span>
                                {noteKey && item[noteKey] ? <em>{item[noteKey]}</em> : null}
                                {item.files?.length ? <FileList files={item.files} /> : null}
                            </div>
                            <span className="activity-mark" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function FileList({files}) {
    return (
        <div className="loan-files" aria-label="Файли позики">
            {files.map(file => (
                <a href={file.url} target="_blank" rel="noreferrer" key={file.path || file.url}>
                    <span aria-hidden="true">{file.type?.startsWith('image/') ? '▧' : '▤'}</span>
                    {file.name || 'Файл'}
                </a>
            ))}
        </div>
    );
}

function MetricTile({label, value}) {
    return (
        <div>
            <span>{label}</span>
            <strong className="money-value">{value}</strong>
        </div>
    );
}

function MetricRow({label, value, accent = false}) {
    return (
        <div className={`metric-row ${accent ? 'accent' : ''}`}>
            <span>{label}</span>
            <strong className="money-value">{value}</strong>
        </div>
    );
}

function Avatar({debtor}) {
    if (debtor.photoUrl) {
        return <img className="avatar" src={debtor.photoUrl} alt="" />;
    }

    return <span className="avatar initials">{getInitials(debtor.name)}</span>;
}

function StatusScreen({title, text}) {
    return (
        <main className="setup-screen">
            <div>
                <p className="eyebrow">Loan Tracker</p>
                <h1>{title}</h1>
                <p>{text}</p>
            </div>
        </main>
    );
}

function NoDebtors() {
    return (
        <div className="no-debtors">
            <h2>Немає людей</h2>
            <p>Імпортуй дані в PostgreSQL, і вони з&apos;являться тут автоматично.</p>
        </div>
    );
}

function attachRatings(debtors) {
    const normalizedDebtors = debtors.map(debtor => ({
        ...debtor,
        borrowed: Number(debtor.borrowed) || 0,
        repaid: Number(debtor.repaid) || 0,
        remaining: Number(debtor.remaining) || 0,
        loans: debtor.loans || [],
        repayments: debtor.repayments || [],
    }));
    const maxRemaining = Math.max(...normalizedDebtors.map(debtor => debtor.remaining), 0);

    return normalizedDebtors.map(debtor => ({
        ...debtor,
        rating: calculateDebtorRating({
            borrowed: debtor.borrowed,
            repaid: debtor.repaid,
            remaining: debtor.remaining,
            loans: debtor.loans,
            repayments: debtor.repayments,
            maxRemaining,
        }),
    }));
}

function calculateDebtorRating({borrowed, repaid, remaining, loans, repayments, maxRemaining}) {
    const now = startOfDay(new Date());
    const sortedLoans = [...loans]
        .filter(loan => loan.amount > 0)
        .sort((a, b) => dateTime(a.date) - dateTime(b.date))
        .map(loan => ({
            ...loan,
            remaining: loan.amount,
        }));
    const sortedRepayments = [...repayments]
        .filter(repayment => repayment.amount > 0)
        .sort((a, b) => dateTime(a.date) - dateTime(b.date));
    const paidAllocations = [];

    sortedRepayments.forEach(repayment => {
        let amountLeft = repayment.amount;
        sortedLoans.forEach(loan => {
            if (amountLeft <= 0 || loan.remaining <= 0) {
                return;
            }

            const allocated = Math.min(amountLeft, loan.remaining);
            const repaymentDate = dateOrToday(repayment.date, now);
            const loanDate = dateOrToday(loan.date, now);
            const dueDate = loan.dueDate ? startOfDay(new Date(loan.dueDate)) : null;

            paidAllocations.push({
                amount: allocated,
                daysToRepay: diffDays(loanDate, repaymentDate),
                lateDays: dueDate ? Math.max(0, diffDays(dueDate, repaymentDate)) : 0,
            });

            loan.remaining -= allocated;
            amountLeft -= allocated;
        });
    });

    const activeLots = sortedLoans.filter(loan => loan.remaining > 0);
    const activeDebt = remaining || sumBy(activeLots, 'remaining');
    const overdueAmount = activeLots.reduce((total, loan) => {
        if (!loan.dueDate) {
            return total;
        }

        const overdueDays = Math.max(0, diffDays(startOfDay(new Date(loan.dueDate)), now));
        return total + (overdueDays > 0 ? loan.remaining : 0);
    }, 0);
    const avgRepaymentDays = weightedAverage(paidAllocations, 'daysToRepay');
    const avgActiveDebtAge = weightedAverage(
        activeLots.map(loan => ({
            amount: loan.remaining,
            age: diffDays(dateOrToday(loan.date, now), now),
        })),
        'age',
    );
    const avgOverdueDays = weightedAverage(
        activeLots.map(loan => ({
            amount: loan.remaining,
            overdue: loan.dueDate
                ? Math.max(0, diffDays(startOfDay(new Date(loan.dueDate)), now))
                : 0,
        })),
        'overdue',
    );
    const repaymentRatio = borrowed > 0 ? repaid / borrowed : 1;
    const activeDebtRatio = borrowed > 0 ? activeDebt / borrowed : 0;
    const absoluteDebtRatio = maxRemaining > 0 ? activeDebt / maxRemaining : 0;
    const overdueDebtRatio = borrowed > 0 ? overdueAmount / borrowed : 0;
    const hasRepaymentTiming = paidAllocations.length > 0;
    const repaymentScore = clamp(repaymentRatio * 100, 0, 100);
    const activeDebtScore = clamp(100 - activeDebtRatio * 100, 0, 100);
    const absoluteDebtScore = clamp(100 - absoluteDebtRatio * 100, 0, 100);
    const speedScore = scoreSpeed(
        avgRepaymentDays,
        avgActiveDebtAge,
        activeDebt > 0,
        hasRepaymentTiming,
    );
    const overdueScore = clamp(100 - overdueDebtRatio * 75 - avgOverdueDays * 1.2, 0, 100);
    const consistencyScore = scoreConsistency({
        loanCount: loans.length,
        repaymentCount: repayments.length,
        activeDebt,
        repaid,
    });
    const score = Math.round(
        repaymentScore * 0.24 +
            activeDebtScore * 0.18 +
            absoluteDebtScore * 0.12 +
            speedScore * 0.18 +
            overdueScore * 0.18 +
            consistencyScore * 0.1,
    );

    return {
        score,
        label: ratingLabel(score),
        tone: ratingTone(score),
        factors: [
            {
                key: 'repayment',
                label: 'Дисципліна повернення',
                value: `${Math.round(repaymentRatio * 100)}%`,
                score: Math.round(repaymentScore),
                note: `${formatMoney(repaid)} повернуто з ${formatMoney(borrowed)}.`,
            },
            {
                key: 'active-debt',
                label: 'Активний борг',
                value: formatMoney(activeDebt),
                score: Math.round(activeDebtScore),
                note: `${Math.round(activeDebtRatio * 100)}% від усіх позик ще не закрито.`,
            },
            {
                key: 'debt-size',
                label: 'Розмір боргу',
                value: `${Math.round(absoluteDebtRatio * 100)}%`,
                score: Math.round(absoluteDebtScore),
                note: 'Порівнює активний борг з найбільшим боргом серед усіх людей.',
            },
            {
                key: 'speed',
                label: 'Середній час повернення',
                value: hasRepaymentTiming ? `${Math.round(avgRepaymentDays)} дн.` : 'Немає даних',
                score: Math.round(speedScore),
                note:
                    !hasRepaymentTiming
                        ? `Активний борг у середньому висить ${Math.round(avgActiveDebtAge)} дн.`
                        : 'Рахується за FIFO: старі позики закриваються першими.',
            },
            {
                key: 'overdue',
                label: 'Прострочка',
                value: overdueAmount > 0 ? formatMoney(overdueAmount) : 'Немає',
                score: Math.round(overdueScore),
                note:
                    overdueAmount > 0
                        ? `Середня прострочка активного боргу: ${Math.round(avgOverdueDays)} дн.`
                        : 'Активні прострочені суми не знайдені.',
            },
            {
                key: 'consistency',
                label: 'Стабільність платежів',
                value: `${repayments.length}/${loans.length}`,
                score: Math.round(consistencyScore),
                note: 'Порівнює кількість повернень з кількістю позик і наявність відкритого боргу.',
            },
        ],
    };
}

function scoreSpeed(avgRepaymentDays, avgActiveDebtAge, hasActiveDebt, hasRepaymentTiming) {
    if (hasRepaymentTiming) {
        return clamp(110 - avgRepaymentDays * 1.35, 5, 100);
    }

    if (!hasActiveDebt) {
        return 90;
    }

    return clamp(70 - avgActiveDebtAge * 0.8, 5, 70);
}

function scoreConsistency({loanCount, repaymentCount, activeDebt, repaid}) {
    if (loanCount === 0) {
        return 100;
    }

    const eventScore = clamp((repaymentCount / loanCount) * 70, 0, 70);
    const closureBonus = activeDebt <= 0 && repaid > 0 ? 30 : 0;
    const noPaymentPenalty = repaymentCount === 0 && activeDebt > 0 ? 25 : 0;

    return clamp(eventScore + closureBonus - noPaymentPenalty, 0, 100);
}

function ratingLabel(score) {
    if (score >= 85) {
        return 'Надійний';
    }
    if (score >= 65) {
        return 'Стабільний';
    }
    if (score >= 45) {
        return 'Ризиковий';
    }
    return 'Критичний';
}

function ratingTone(score) {
    if (score >= 75) {
        return 'good';
    }
    if (score >= 45) {
        return 'warning';
    }
    return 'critical';
}

function sumBy(items, key) {
    return items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
}

function groupByDebtor(rows, mapper) {
    return rows.reduce((map, row) => {
        const items = map.get(row.debtor_id) || [];
        items.push(mapper(row));
        map.set(row.debtor_id, items);
        return map;
    }, new Map());
}

function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeFiles(files) {
    return Array.isArray(files)
        ? files.filter(file => file && typeof file.url === 'string' && file.url.length > 0)
        : [];
}

function dateTime(value) {
    return dateOrToday(value, new Date(0)).getTime();
}

function dateOrToday(value, fallbackDate) {
    if (!value) {
        return fallbackDate;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallbackDate : startOfDay(date);
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function diffDays(fromDate, toDate) {
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    return Math.max(0, Math.round((toDate.getTime() - fromDate.getTime()) / millisecondsPerDay));
}

function weightedAverage(items, valueKey) {
    const totalWeight = items.reduce((total, item) => total + (Number(item.amount) || 0), 0);

    if (totalWeight <= 0) {
        return 0;
    }

    return (
        items.reduce(
            (total, item) => total + (Number(item[valueKey]) || 0) * (Number(item.amount) || 0),
            0,
        ) / totalWeight
    );
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function formatMoney(value) {
    return new Intl.NumberFormat('uk-UA', {
        style: 'currency',
        currency: 'UAH',
        maximumFractionDigits: 2,
    }).format(Number(value) || 0);
}

function formatDate(value) {
    if (!value) {
        return 'Без дати';
    }

    return new Intl.DateTimeFormat('uk-UA', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(new Date(value));
}

function getInitials(name) {
    return name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0])
        .join('')
        .toUpperCase();
}

createRoot(document.getElementById('root')).render(<LoanTrackerApp />);
