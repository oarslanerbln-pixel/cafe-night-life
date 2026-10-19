import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
    errorInfo?: ErrorInfo;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
        this.setState({ errorInfo });
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-screen bg-black text-red-500 p-8">
                    <h1 className="text-4xl font-bold mb-4">Ein Fehler ist aufgetreten</h1>
                    <p className="mb-4 text-white text-xl">Bitte mach ein Foto von diesem Bildschirm oder kopiere die Fehlermeldung:</p>
                    <div className="bg-gray-900 p-6 rounded-lg text-left w-full max-w-4xl overflow-auto border border-red-500">
                        <h2 className="text-2xl font-mono text-red-400 mb-2">{this.state.error?.toString()}</h2>
                        <pre className="text-sm font-mono text-gray-300 whitespace-pre-wrap">
                            {this.state.error?.stack}
                        </pre>
                    </div>
                    <button
                        className="mt-8 px-6 py-3 bg-red-600 text-white rounded-lg font-bold"
                        onClick={() => window.location.reload()}
                    >
                        Seite neu laden
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
