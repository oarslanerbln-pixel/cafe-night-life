import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useMotionValue, useTransform, useSpring, AnimatePresence } from 'framer-motion';
import { KineticSpark } from '../components/KineticSpark';

function TiltCard({ children, onClick, className }: { children: React.ReactNode, onClick: () => void, className: string }) {
    const x = useMotionValue(0);
    const y = useMotionValue(0);

    const mouseXSpring = useSpring(x);
    const mouseYSpring = useSpring(y);

    const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["10deg", "-10deg"]);
    const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-10deg", "10deg"]);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const xPct = mouseX / width - 0.5;
        const yPct = mouseY / height - 0.5;

        x.set(xPct);
        y.set(yPct);
    };

    const handleMouseLeave = () => {
        x.set(0);
        y.set(0);
    };

    return (
        <motion.div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick();
                }
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={onClick}
            style={{
                rotateY,
                rotateX,
                transformStyle: "preserve-3d",
            }}
            className={`${className} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alaz-orange/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black`}
        >
            <div className="card-inner-content">
                {children}
            </div>
        </motion.div>
    );
}

export function LandingPage() {
    const navigate = useNavigate();
    const [showIntro, setShowIntro] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => setShowIntro(false), 4000);
        return () => clearTimeout(timer);
    }, []);

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-seljuk-pattern min-h-screen relative overflow-hidden">
            <AnimatePresence mode="wait">
                {showIntro ? (
                    <motion.div
                        key="intro"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, scale: 1.2, filter: 'blur(40px)' }}
                        transition={{ duration: 1.5, ease: "circIn" }}
                        className="bg-black fixed inset-0 z-[100] flex items-center justify-center overflow-hidden noise-suppression"
                    >
                        <div className="relative w-full max-w-7xl flex flex-col items-center justify-center">
                            <KineticSpark delay={0.5} showTagline tagline="Uraltes Feuer • Moderner Geist" />
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: [0, 0.1, 0.05, 0.15] }}
                                transition={{ delay: 2, duration: 4, repeat: Infinity, repeatType: "mirror" }}
                                className="absolute inset-0 bg-alaz-orange/10 blur-[150px] -z-10 rounded-full"
                            />
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="content"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 1 }}
                        className="w-full max-w-4xl"
                    >
                        {/* Brand Logo - Integrated into page */}
                        <div className="mb-16 pointer-events-none opacity-80 scale-90">
                            <KineticSpark showTagline delay={0.2} />
                        </div>

                {/* Role Selection Buttons with 3D Tilt */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-2xl mx-auto">

                    <TiltCard
                        onClick={() => navigate('/host/setup')}
                        className="group relative overflow-hidden p-8 rounded-3xl transition-all glass-panel-alaz hover:border-alaz-orange/50 cursor-pointer"
                    >
                        <div className="relative z-10 text-left">
                            <span className="text-alaz-orange text-xs uppercase tracking-widest font-black block mb-2 opacity-70 group-hover:opacity-100 transition-opacity">Gastgeber</span>
                            <h2 className="text-3xl font-black text-white mb-2 italic tracking-tight uppercase">Raum erstellen</h2>
                            <p className="text-gray-400 text-sm leading-relaxed">Entfache das Spiel auf dem TV und lade deine Freunde ein!</p>
                        </div>
                        <div className="absolute -inset-full bg-gradient-to-br from-alaz-orange/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-2xl" />
                    </TiltCard>

                    <TiltCard
                        onClick={() => navigate('/join')}
                        className="group relative overflow-hidden p-8 rounded-3xl transition-all glass-panel-neon-blue hover:border-neon-blue/50 cursor-pointer"
                    >
                        <div className="relative z-10 text-left">
                            <span className="text-neon-blue text-xs uppercase tracking-widest font-black block mb-2 opacity-70 group-hover:opacity-100 transition-opacity">Spieler / Gast</span>
                            <h2 className="text-3xl font-black text-white mb-2 italic tracking-tight uppercase">Beitreten</h2>
                            <p className="text-gray-400 text-sm leading-relaxed">Steig mit deinem Handy ein und zeig, was in dir steckt!</p>
                        </div>
                        <div className="absolute -inset-full bg-gradient-to-br from-neon-blue/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-2xl" />
                    </TiltCard>

                </div>

                <div className="mt-20">
                    <p className="text-gray-500 text-sm uppercase tracking-widest font-medium">Bereit für die ultimative Herausforderung?</p>
                </div>

                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
