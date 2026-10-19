import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { playCinematicWhoosh } from '../lib/soundSynth';

interface KineticSparkProps {
    className?: string;
    fontSize?: string;
    delay?: number;
    showTagline?: boolean;
    tagline?: string;
}

export function KineticSpark({
    className = "",
    fontSize = "text-[11rem]",
    delay = 0,
    showTagline = false,
    tagline = "Uraltes Feuer • Moderner Geist"
}: KineticSparkProps) {
    useEffect(() => {
        // Impact: wordmark flash
        const timer = setTimeout(() => {
            playCinematicWhoosh();
        }, (delay + 0.4) * 1000);

        return () => clearTimeout(timer);
    }, [delay]);

    return (
        <div className={`relative w-full h-full noise-suppression overflow-visible flex flex-col items-center justify-center ${className}`}>
            {/* Screen Shake Container */}
            <motion.div
                animate={{
                    x: [0, -10, 10, -5, 5, 0],
                    y: [0, 5, -5, 2, -2, 0]
                }}
                transition={{
                    delay: delay + 0.5, // Trigger on impact
                    duration: 0.4,
                    ease: "easeInOut"
                }}
                className="relative w-full overflow-visible"
            >
                <svg viewBox="0 0 1000 320" className="w-full h-auto overflow-visible">
                    <defs>
                        {/* Solar Flare Glow */}
                        <radialGradient id="solarFlareGradient" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="#ff4d00" stopOpacity="0.8" />
                            <stop offset="100%" stopColor="#ff4d00" stopOpacity="0" />
                        </radialGradient>
                      
                        <filter id="ultraGlow">
                            <feGaussianBlur stdDeviation="15" result="blur" />
                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                    </defs>

                    {/* Central Flare Burst */}
                    <motion.circle
                        cx="50%"
                        cy="50%"
                        r="0"
                        fill="url(#solarFlareGradient)"
                        initial={{ r: 0, opacity: 0 }}
                        animate={{
                            r: [0, 300, 450],
                            opacity: [0, 1, 0]
                        }}
                        transition={{
                            delay: delay + 0.2,
                            duration: 0.8,
                            times: [0, 0.4, 1],
                            ease: "easeOut"
                        }}
                    />

                    {/* Wordmark reveal (flying from center/back) */}
                    <motion.text
                        x="50%"
                        y="50%"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className={`${fontSize} font-black italic tracking-tighter`}
                        initial={{ scale: 0, opacity: 0, fill: "#ff4d00" }}
                        animate={{
                            scale: [0.1, 1.2, 1],
                            opacity: [0, 1, 1],
                            fill: ["#ff4d00", "#ffffff", "transparent"]
                        }}
                        transition={{
                            delay: delay + 0.4,
                            duration: 1.2,
                            times: [0, 0.6, 1],
                            ease: "easeOut"
                        }}
                        style={{
                            stroke: "var(--color-alaz-orange)",
                            strokeWidth: 2,
                            strokeDasharray: 2000,
                            strokeDashoffset: 0
                        }}
                    >
                        HENGAME
                    </motion.text>

                    {/* Final Premium Glow Overlay */}
                    <motion.g
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: delay + 1.8, duration: 1 }}
                    >
                        <text
                            x="50%" y="50%" textAnchor="middle" dominantBaseline="middle"
                            className={`${fontSize} font-black italic tracking-tighter text-glow-premium-alaz fill-white/10`}
                        >
                            HENGAME
                        </text>
                    </motion.g>
                </svg>
            </motion.div>

            {showTagline && (
                <motion.p
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 0.8, scale: 1 }}
                    transition={{ delay: delay + 2.5, duration: 0.8 }}
                    className="mt-4 px-4 text-alaz-orange text-sm md:text-2xl tracking-[0.3em] md:tracking-[0.5em] uppercase font-bold text-center"
                >
                    {tagline}
                </motion.p>
            )}
        </div>
    );
}
