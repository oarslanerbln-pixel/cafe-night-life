import { motion } from 'framer-motion';

export type LeaderboardEntry = {
    id: string;
    name: string;
    total: number;
    rank: number;
    /** Points earned this round (review view). */
    roundScore?: number;
    /** Places gained (+) or lost (-) versus before this round. Omit when there is nothing to compare. */
    movement?: number;
    /** Points per round, oldest first (final view). */
    rounds?: number[];
};

type Props = {
    entries: LeaderboardEntry[];
    variant?: 'review' | 'final';
};

const MEDAL: Record<number, string> = {
    1: 'bg-gradient-to-br from-yellow-200 to-yellow-500 text-black shadow-[0_0_18px_rgba(250,204,21,0.45)]',
    2: 'bg-gradient-to-br from-slate-100 to-slate-400 text-black',
    3: 'bg-gradient-to-br from-orange-300 to-amber-700 text-black',
};

function Movement({ value }: { value: number }) {
    if (value === 0) return <span className="w-10 text-center text-xs font-black text-gray-600">–</span>;
    const up = value > 0;
    return (
        <span className={`w-10 text-center text-xs font-black tabular-nums ${up ? 'text-green-400' : 'text-red-400'}`}>
            {up ? '▲' : '▼'}{Math.abs(value)}
        </span>
    );
}

export function Leaderboard({ entries, variant = 'review' }: Props) {
    const max = Math.max(1, ...entries.map(e => e.total));
    const compact = variant === 'final';
    const roundCount = compact ? Math.max(0, ...entries.map(e => e.rounds?.length ?? 0)) : 0;

    return (
        <div>
            {roundCount > 0 && (
                <div className="flex items-center gap-3 px-4 pb-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
                    <span className="w-10" />
                    <span className="flex-1">Spieler</span>
                    {Array.from({ length: roundCount }, (_, i) => (
                        <span key={i} className="w-9 text-center">R{i + 1}</span>
                    ))}
                    <span className="w-16 text-right">Gesamt</span>
                </div>
            )}
            <ol aria-label="Punktetabelle" className={`flex flex-col ${compact ? 'gap-1.5' : 'gap-2'}`}>
                {entries.map(e => {
                    const leader = e.rank === 1;
                    return (
                        <motion.li
                            key={e.id}
                            layout
                            transition={{ type: 'spring', stiffness: 350, damping: 34 }}
                            className={`relative overflow-hidden rounded-2xl border ${leader
                                ? 'border-alaz-orange/60 bg-alaz-orange/10 shadow-[0_0_30px_rgba(255,77,0,0.15)]'
                                : 'border-white/10 bg-white/5'}`}
                        >
                            <motion.div
                                aria-hidden
                                className={`absolute inset-y-0 left-0 bg-gradient-to-r ${leader ? 'from-alaz-orange/30' : 'from-white/10'} to-transparent`}
                                initial={{ width: 0 }}
                                animate={{ width: `${(e.total / max) * 100}%` }}
                                transition={{ duration: 0.8, ease: 'easeOut' }}
                            />
                            <div className={`relative flex items-center gap-3 px-4 ${compact ? 'py-2' : 'py-3'}`}>
                                <span className={`flex shrink-0 items-center justify-center rounded-full font-black tabular-nums ${compact ? 'h-9 w-9 text-base' : 'h-10 w-10 text-lg'} ${MEDAL[e.rank] ?? 'bg-white/10 text-gray-300'}`}>
                                    {e.rank}
                                </span>
                                <span className={`min-w-0 flex-1 truncate font-black text-white ${compact ? 'text-lg' : 'text-xl'}`}>{e.name}</span>
                                {e.movement !== undefined && <Movement value={e.movement} />}
                                {e.roundScore !== undefined && (
                                    <span className={`w-16 rounded-full px-2 py-1 text-center text-xs font-black tabular-nums ${e.roundScore > 0
                                        ? 'bg-green-500/15 text-green-400'
                                        : 'bg-white/5 text-gray-600'}`}>
                                        {e.roundScore > 0 ? `+${e.roundScore}` : '0'}
                                    </span>
                                )}
                                {e.rounds?.map((pts, i) => (
                                    <span key={i} className={`w-9 text-center text-sm font-bold tabular-nums ${pts > 0 ? 'text-gray-300' : 'text-gray-600'}`}>{pts}</span>
                                ))}
                                <span className={`w-16 text-right font-black tabular-nums ${compact ? 'text-2xl' : 'text-3xl'} ${leader ? 'text-alaz-orange' : 'text-white'}`}>
                                    {e.total}
                                </span>
                            </div>
                        </motion.li>
                    );
                })}
            </ol>
        </div>
    );
}
