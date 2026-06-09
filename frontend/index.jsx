import {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {hasSupabaseConfig, supabase} from './supabase.js';
import './style.css';

function LoanTrackerApp() {
    const {addDebtor, addLoan, addRepayment, debtors, error, isLoading} = useDebtors();

    if (isLoading) {
        return <StatusScreen title="Завантаження даних" text="Підключаюся до Supabase та завантажую профілі..." />;
    }

    if (error) {
        return (
            <StatusScreen
                title="Не вдалося завантажити дані"
                text={`${error.message}. Перевірте налаштування Supabase (URL, publishable key) та структуру таблиць.`}
            />
        );
    }

    return <LoanDashboard debtors={debtors} onAddDebtor={addDebtor} onAddLoan={addLoan} onAddRepayment={addRepayment} />;
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

    async function addLoan(debtorId, input) {
        const updatedDebtor = await createLoan(debtorId, input);
        setDebtors(currentDebtors => attachRatings(replaceDebtor(currentDebtors, updatedDebtor)));
        return updatedDebtor;
    }

    async function addRepayment(debtorId, input) {
        const updatedDebtor = await createRepayment(debtorId, input);
        setDebtors(currentDebtors => attachRatings(replaceDebtor(currentDebtors, updatedDebtor)));
        return updatedDebtor;
    }

    return {addDebtor, addLoan, addRepayment, debtors, error, isLoading};
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

async function createLoan(debtorId, input) {
    const response = await fetch(`/api/debtors/${debtorId}/loans`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(input),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload.error || 'Не вдалося додати позику');
    }

    return payload.debtor;
}

async function createRepayment(debtorId, input) {
    const response = await fetch(`/api/debtors/${debtorId}/repayments`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(input),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload.error || 'Не вдалося додати повернення');
    }

    return payload.debtor;
}

function LoanDashboard({debtors, onAddDebtor, onAddLoan, onAddRepayment}) {
    const [isAddPersonOpen, setIsAddPersonOpen] = useState(false);
    const [transactionDialog, setTransactionDialog] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRecordId, setSelectedRecordId] = useState(null);
    const searchRef = useRef(null);

    // Keyboard shortcut listener to focus search input using '/'
    useEffect(() => {
        function handleKeyDown(event) {
            if (
                event.key === '/' &&
                document.activeElement?.tagName !== 'INPUT' &&
                document.activeElement?.tagName !== 'TEXTAREA'
            ) {
                event.preventDefault();
                searchRef.current?.focus();
            }
            if (event.key === 'Escape' && document.activeElement === searchRef.current) {
                searchRef.current?.blur();
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const filteredDebtors = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();
        const visible = normalizedSearch
            ? debtors.filter(debtor => debtor.name.toLowerCase().includes(normalizedSearch))
            : debtors;

        return [...visible].sort((a, b) => b.remaining - a.remaining);
    }, [debtors, searchTerm]);

    const selectedDebtor =
        debtors.find(debtor => debtor.id === selectedRecordId) ?? filteredDebtors[0] ?? debtors[0];

    const totalRemaining = sumBy(debtors, 'remaining');
    const totalBorrowed = sumBy(debtors, 'borrowed');
    const totalRepaid = sumBy(debtors, 'repaid');

    return (
        <main className="loan-shell">
            <aside className="people-panel">
                <section className="panel-header">
                    <div className="brand-group">
                        <span className="brand-badge">LT</span>
                        <div>
                            <p className="eyebrow">Облік позик</p>
                            <h1>Хлопці <span className="header-counter">{debtors.length}</span></h1>
                        </div>
                    </div>
                    <button
                        aria-label="Додати людину"
                        className="add-person-button"
                        onClick={() => setIsAddPersonOpen(true)}
                        type="button"
                    >
                        <svg className="button-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        <span>Додати</span>
                    </button>
                </section>

                <section className="summary-strip" aria-label="Загальна статистика">
                    <MetricTile label="Активний борг" value={formatMoney(totalRemaining)} type="remaining" />
                    <MetricTile label="Позичено" value={formatMoney(totalBorrowed)} type="borrowed" />
                    <MetricTile label="Повернено" value={formatMoney(totalRepaid)} type="repaid" />
                </section>

                <section className="toolbar" aria-label="Пошук">
                    <div className="search-box">
                        <svg className="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            ref={searchRef}
                            value={searchTerm}
                            onChange={event => setSearchTerm(event.target.value)}
                            placeholder="Шукати боржника..."
                        />
                        <span className="hotkey-badge">/</span>
                    </div>
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
                                <strong className="person-name">{debtor.name}</strong>
                                <span className={`money-value ${debtor.remaining > 0 ? 'has-debt' : 'no-debt'}`}>
                                    {formatMoney(debtor.remaining)}
                                </span>
                            </span>
                            <div className="status-indicator">
                                <span className={debtor.remaining > 0 ? 'status-dot due' : 'status-dot'} />
                            </div>
                        </button>
                    ))}
                    {filteredDebtors.length === 0 ? (
                        <div className="empty-state">
                            <svg className="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                            </svg>
                            <strong>Нікого не знайдено</strong>
                            <span>Спробуйте змінити запит пошуку.</span>
                        </div>
                    ) : null}
                </section>
            </aside>

            <section className="detail-panel">
                {selectedDebtor ? (
                    <DebtorDetail
                        debtor={selectedDebtor}
                        onAddLoan={() => setTransactionDialog({type: 'loan', debtor: selectedDebtor})}
                        onAddRepayment={() => setTransactionDialog({type: 'repayment', debtor: selectedDebtor})}
                    />
                ) : (
                    <NoDebtors />
                )}
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

            {transactionDialog ? (
                <TransactionDialog
                    debtor={transactionDialog.debtor}
                    type={transactionDialog.type}
                    onClose={() => setTransactionDialog(null)}
                    onCreate={async formValues => {
                        const updatedDebtor =
                            transactionDialog.type === 'loan'
                                ? await onAddLoan(transactionDialog.debtor.id, formValues)
                                : await onAddRepayment(transactionDialog.debtor.id, formValues);
                        setSelectedRecordId(updatedDebtor.id);
                        setTransactionDialog(null);
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
    });
    const [selectedFile, setSelectedFile] = useState(null);
    const [filePreview, setFilePreview] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Keyboard hook to dismiss modal using Escape key
    useEffect(() => {
        function handleKeyDown(event) {
            if (event.key === 'Escape') {
                onClose();
            }
        }
        document.addEventListener('keydown', handleKeyDown);
        // Disable document scroll under overlay
        document.body.classList.add('modal-open');
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.classList.remove('modal-open');
        };
    }, [onClose]);

    function toBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = error => reject(error);
        });
    }

    async function handleSubmit(event) {
        event.preventDefault();
        setError('');

        if (!formValues.firstName.trim() && !formValues.lastName.trim()) {
            setError('Вкажіть хоча б імʼя або прізвище.');
            return;
        }

        setIsSubmitting(true);

        try {
            let uploadedPhotoUrl = '';
            if (selectedFile) {
                if (hasSupabaseConfig && supabase) {
                    const uploadResponse = await fetch('/api/upload', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            fileName: selectedFile.name,
                            contentType: selectedFile.type,
                        }),
                    });

                    if (!uploadResponse.ok) {
                        const payload = await uploadResponse.json().catch(() => ({}));
                        throw new Error(payload.error || 'Помилка підготовки завантаження фото.');
                    }

                    const uploadPayload = await uploadResponse.json();
                    const {error: uploadError} = await supabase.storage
                        .from(uploadPayload.bucket)
                        .uploadToSignedUrl(uploadPayload.path, uploadPayload.token, selectedFile, {
                            cacheControl: '3600',
                            contentType: selectedFile.type,
                        });

                    if (uploadError) {
                        throw new Error(`Помилка завантаження фото в Supabase: ${uploadError.message}`);
                    }

                    uploadedPhotoUrl = uploadPayload.publicUrl;
                } else {
                    const base64Data = await toBase64(selectedFile);
                    const response = await fetch('/api/upload', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            fileName: selectedFile.name,
                            fileData: base64Data,
                        }),
                    });

                    if (!response.ok) {
                        const payload = await response.json().catch(() => ({}));
                        throw new Error(payload.error || 'Помилка завантаження фото на сервер.');
                    }

                    const payload = await response.json();
                    uploadedPhotoUrl = payload.url;
                }
            }

            await onCreate({
                firstName: formValues.firstName,
                lastName: formValues.lastName,
                photoUrl: uploadedPhotoUrl || '',
            });
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

    function handleFileChange(event) {
        const file = event.target.files?.[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                setError('Будь ласка, виберіть зображення.');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                setError('Розмір фото не повинен перевищувати 5MB.');
                return;
            }
            setSelectedFile(file);
            setFilePreview(URL.createObjectURL(file));
            setError('');
        }
    }

    // Handles modal backdrop click
    function handleBackdropClick(event) {
        if (event.target === event.currentTarget) {
            onClose();
        }
    }

    return (
        <div className="dialog-backdrop" onClick={handleBackdropClick} role="presentation">
            <form className="person-dialog" onSubmit={handleSubmit}>
                <div className="dialog-head">
                    <div>
                        <p className="eyebrow">Карта профілю</p>
                        <h2>Додати людину</h2>
                    </div>
                    <button aria-label="Закрити" className="icon-button" onClick={onClose} type="button">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="form-grid">
                    <label className="form-field">
                        <span>Імʼя</span>
                        <input
                            autoFocus
                            onChange={event => updateField('firstName', event.target.value)}
                            placeholder="Віталій"
                            value={formValues.firstName}
                        />
                    </label>
                    <label className="form-field">
                        <span>Прізвище</span>
                        <input
                            onChange={event => updateField('lastName', event.target.value)}
                            placeholder="Тарківський"
                            value={formValues.lastName}
                        />
                    </label>
                    <div className="form-field wide-field">
                        <span>Фото профілю</span>
                        {filePreview ? (
                            <div className="image-preview-container">
                                <img src={filePreview} alt="Попередній перегляд" className="uploaded-preview" />
                                <button
                                    type="button"
                                    className="clear-preview-btn"
                                    onClick={() => {
                                        setSelectedFile(null);
                                        setFilePreview('');
                                    }}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                    <span>Видалити</span>
                                </button>
                            </div>
                        ) : (
                            <label className="file-upload-zone">
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                    className="hidden-file-input"
                                    style={{display: 'none'}}
                                />
                                <svg className="upload-zone-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span className="upload-zone-text">Виберіть фото профілю</span>
                                <span className="upload-zone-subtext">PNG, JPG, WEBP до 5MB</span>
                            </label>
                        )}
                    </div>
                </div>

                {error ? (
                    <div className="form-error">
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span>{error}</span>
                    </div>
                ) : null}

                <div className="dialog-actions">
                    <button className="secondary-button" onClick={onClose} type="button">
                        Скасувати
                    </button>
                    <button className="primary-button" disabled={isSubmitting} type="submit">
                        {isSubmitting ? (
                            <>
                                <span className="spinner" />
                                <span>Додаю...</span>
                            </>
                        ) : (
                            'Додати людину'
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}

function TransactionDialog({debtor, type, onClose, onCreate}) {
    const isLoan = type === 'loan';
    const [error, setError] = useState('');
    const [formValues, setFormValues] = useState({
        amount: '',
        date: getTodayInputValue(),
        dueDate: '',
        notes: '',
    });
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        function handleKeyDown(event) {
            if (event.key === 'Escape') {
                onClose();
            }
        }
        document.addEventListener('keydown', handleKeyDown);
        document.body.classList.add('modal-open');
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.classList.remove('modal-open');
        };
    }, [onClose]);

    async function handleSubmit(event) {
        event.preventDefault();
        setError('');

        const amount = Number(String(formValues.amount).replace(',', '.'));
        if (!Number.isFinite(amount) || amount <= 0) {
            setError('Вкажіть суму більшу за 0.');
            return;
        }

        if (!formValues.date) {
            setError(isLoan ? 'Вкажіть дату позики.' : 'Вкажіть дату повернення.');
            return;
        }

        setIsSubmitting(true);

        try {
            const files = isLoan ? await uploadLoanFiles(selectedFiles) : [];
            await onCreate({
                amount,
                date: formValues.date,
                dueDate: isLoan ? formValues.dueDate : '',
                notes: isLoan ? formValues.notes : '',
                files,
            });
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

    function handleFilesChange(event) {
        const files = Array.from(event.target.files || []);
        const oversizedFile = files.find(file => file.size > 20 * 1024 * 1024);

        if (oversizedFile) {
            setError('Один файл не повинен перевищувати 20MB.');
            return;
        }

        setSelectedFiles(files);
        setError('');
    }

    function handleBackdropClick(event) {
        if (event.target === event.currentTarget) {
            onClose();
        }
    }

    return (
        <div className="dialog-backdrop" onClick={handleBackdropClick} role="presentation">
            <form className="person-dialog transaction-dialog" onSubmit={handleSubmit}>
                <div className="dialog-head">
                    <div>
                        <p className="eyebrow">{debtor.name}</p>
                        <h2>{isLoan ? 'Нова позика' : 'Нове повернення'}</h2>
                    </div>
                    <button aria-label="Закрити" className="icon-button" onClick={onClose} type="button">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="form-grid">
                    <label className="form-field">
                        <span>Сума, грн</span>
                        <input
                            autoFocus
                            inputMode="decimal"
                            min="0.01"
                            onChange={event => updateField('amount', event.target.value)}
                            placeholder="1500"
                            step="0.01"
                            type="number"
                            value={formValues.amount}
                        />
                    </label>
                    <label className="form-field">
                        <span>{isLoan ? 'Дата позики' : 'Дата повернення'}</span>
                        <input
                            onChange={event => updateField('date', event.target.value)}
                            type="date"
                            value={formValues.date}
                        />
                    </label>

                    {isLoan ? (
                        <>
                            <label className="form-field">
                                <span>Повернути до</span>
                                <input
                                    onChange={event => updateField('dueDate', event.target.value)}
                                    type="date"
                                    value={formValues.dueDate}
                                />
                            </label>
                            <label className="form-field">
                                <span>Файли</span>
                                <input multiple onChange={handleFilesChange} type="file" />
                            </label>
                            <label className="form-field wide-field">
                                <span>Нотатки</span>
                                <textarea
                                    onChange={event => updateField('notes', event.target.value)}
                                    placeholder="Короткий опис або домовленість"
                                    rows="4"
                                    value={formValues.notes}
                                />
                            </label>
                        </>
                    ) : null}
                </div>

                {selectedFiles.length ? (
                    <div className="selected-file-list">
                        {selectedFiles.map(file => (
                            <span className="selected-file-chip" key={`${file.name}-${file.size}`}>
                                {file.name}
                            </span>
                        ))}
                    </div>
                ) : null}

                {error ? (
                    <div className="form-error">
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span>{error}</span>
                    </div>
                ) : null}

                <div className="dialog-actions">
                    <button className="secondary-button" onClick={onClose} type="button">
                        Скасувати
                    </button>
                    <button className="primary-button" disabled={isSubmitting} type="submit">
                        {isSubmitting ? (
                            <>
                                <span className="spinner" />
                                <span>Зберігаю...</span>
                            </>
                        ) : (
                            isLoan ? 'Додати позику' : 'Додати повернення'
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}

async function uploadLoanFiles(files) {
    const uploadedFiles = [];

    for (const file of files) {
        if (hasSupabaseConfig && supabase) {
            const uploadResponse = await fetch('/api/loan-files/upload', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    fileName: file.name,
                    contentType: file.type,
                    size: file.size,
                }),
            });

            if (!uploadResponse.ok) {
                const payload = await uploadResponse.json().catch(() => ({}));
                throw new Error(payload.error || 'Помилка підготовки завантаження файлу.');
            }

            const uploadPayload = await uploadResponse.json();
            const {error: uploadError} = await supabase.storage
                .from(uploadPayload.bucket)
                .uploadToSignedUrl(uploadPayload.path, uploadPayload.token, file, {
                    cacheControl: '3600',
                    contentType: file.type || 'application/octet-stream',
                });

            if (uploadError) {
                throw new Error(`Помилка завантаження файлу в Supabase: ${uploadError.message}`);
            }

            uploadedFiles.push(uploadPayload.file);
            continue;
        }

        const base64Data = await fileToBase64(file);
        const response = await fetch('/api/loan-files/upload', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                fileName: file.name,
                contentType: file.type,
                size: file.size,
                fileData: base64Data,
            }),
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || 'Помилка завантаження файлу на сервер.');
        }

        const payload = await response.json();
        uploadedFiles.push(payload.file);
    }

    return uploadedFiles;
}

function DebtorDetail({debtor, onAddLoan, onAddRepayment}) {
    const rating = debtor.rating;

    return (
        <article className="debtor-detail">
            <header className="detail-hero">
                <div className="profile-identity">
                    <p className="eyebrow">Картка боржника</p>
                    <h2>{debtor.name}</h2>
                </div>
                <RatingBadge rating={rating} />
            </header>

            <section className="profile-grid">
                <div className="photo-card">
                    {debtor.photoUrl ? (
                        <img src={debtor.photoUrl} alt={debtor.name} />
                    ) : (
                        <div className="photo-placeholder">
                            <span>{getInitials(debtor.name)}</span>
                        </div>
                    )}
                </div>

                <div className="ledger-card">
                    <MetricRow label="Загалом позичено" value={formatMoney(debtor.borrowed)} type="borrowed" />
                    <MetricRow label="Загалом повернуто" value={formatMoney(debtor.repaid)} type="repaid" />
                    <MetricRow label="Активний борг" value={formatMoney(debtor.remaining)} accent type="remaining" />
                </div>
            </section>

            <section className="activity-grid">
                <ActivityList
                    title="Позики"
                    emptyLabel="Позики відсутні"
                    items={debtor.loans}
                    amountKey="amount"
                    dateKey="date"
                    noteKey="notes"
                    type="loan"
                    onAdd={onAddLoan}
                />
                <ActivityList
                    title="Повернення"
                    emptyLabel="Повернення відсутні"
                    items={debtor.repayments}
                    amountKey="amount"
                    dateKey="date"
                    type="repayment"
                    onAdd={onAddRepayment}
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
                <div className="rating-title-block">
                    <p className="eyebrow">Аналітика ризиків</p>
                    <h3>Рейтинг боржника</h3>
                </div>
                <div className={`rating-score-card rating-${rating.tone}`}>
                    <div className="score-details">
                        <span>Загальний бал</span>
                        <strong>{rating.score}<span>/100</span></strong>
                        <em>{rating.label}</em>
                    </div>
                    <RatingIcon tone={rating.tone} />
                </div>
            </div>

            <div className="rating-grid">
                {rating.factors.map(factor => (
                    <div className="rating-factor" key={factor.key}>
                        <div className="factor-header">
                            <span>{factor.label}</span>
                            <strong className="factor-value">{factor.value}</strong>
                        </div>
                        <div className="rating-bar" aria-hidden="true">
                            <span style={{width: `${factor.score}%`}} />
                        </div>
                        <p className="factor-note">{factor.note}</p>
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
            <span className="icon-character">{iconMark}</span>
        </span>
    );
}

function ActivityList({title, emptyLabel, items, amountKey, dateKey, noteKey, type, onAdd}) {
    return (
        <div className="activity-card">
            <div className="activity-title">
                <div className="activity-title-copy">
                    <h3>{title}</h3>
                    <span className="activity-badge">{items.length}</span>
                </div>
                <button
                    aria-label={`Додати ${type === 'loan' ? 'позику' : 'повернення'}`}
                    className={`activity-add-button ${type}`}
                    onClick={onAdd}
                    type="button"
                >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                </button>
            </div>
            {items.length === 0 ? (
                <div className="muted-empty">{emptyLabel}</div>
            ) : (
                <div className="activity-list">
                    {items.map(item => (
                        <div className="activity-row" key={item.id}>
                            <div className="activity-content">
                                <div className="activity-primary-line">
                                    <strong className="money-value">{formatMoney(item[amountKey])}</strong>
                                    <span className="activity-date">{formatDate(item[dateKey])}</span>
                                </div>
                                {noteKey && item[noteKey] ? <p className="activity-notes">{item[noteKey]}</p> : null}
                                {item.files?.length ? <FileList files={item.files} /> : null}
                            </div>
                            <div className={`activity-indicator ${type}`}>
                                {type === 'loan' ? (
                                    <svg className="activity-svg warning" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
                                    </svg>
                                ) : (
                                    <svg className="activity-svg success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 4.5l-15 15m0 0h11.25m-11.25 0V8.25" />
                                    </svg>
                                )}
                            </div>
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
            {files.map(file => {
                const isImage = file.type?.startsWith('image/');
                return (
                    <a href={file.url} target="_blank" rel="noreferrer" key={file.path || file.url} className="file-chip">
                        {isImage ? (
                            <svg className="file-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                        ) : (
                            <svg className="file-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        )}
                        <span>{file.name || 'Документ'}</span>
                    </a>
                );
            })}
        </div>
    );
}

function MetricTile({label, value, type}) {
    return (
        <div className={`metric-tile ${type}`}>
            <span className="metric-label">{label}</span>
            <strong className="money-value">{value}</strong>
        </div>
    );
}

function MetricRow({label, value, accent = false, type}) {
    return (
        <div className={`metric-row ${accent ? 'accent' : ''} ${type}`}>
            <span className="metric-label">{label}</span>
            <strong className="money-value">{value}</strong>
        </div>
    );
}

function Avatar({debtor}) {
    if (debtor.photoUrl) {
        return (
            <div className="avatar-container">
                <img className="avatar" src={debtor.photoUrl} alt="" />
            </div>
        );
    }

    return (
        <div className="avatar-container initials-bg">
            <span className="avatar-initials">{getInitials(debtor.name)}</span>
        </div>
    );
}

function StatusScreen({title, text}) {
    return (
        <main className="setup-screen">
            <div className="status-card">
                <div className="logo-pulse">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <p className="eyebrow">Finance</p>
                <h1>{title}</h1>
                <p className="status-text">{text}</p>
            </div>
        </main>
    );
}

function NoDebtors() {
    return (
        <div className="no-debtors-panel">
            <div className="empty-icon-wrapper">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
            </div>
            <h2>Немає людей</h2>
            <p>База даних порожня. Додайте профілі, щоб почати облік позик та аналіз ризиків.</p>
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

function replaceDebtor(debtors, updatedDebtor) {
    return debtors.map(debtor => (debtor.id === updatedDebtor.id ? updatedDebtor : debtor));
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

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = error => reject(error);
    });
}

function getTodayInputValue() {
    const now = new Date();
    const timezoneOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function dateTime(value) {
    return dateOrToday(value, new Date(0)).getTime();
}

// Fixed date parsing helper
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
