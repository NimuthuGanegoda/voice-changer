import React, { lazy, Suspense, useMemo } from "react";
import { ErrorBoundary } from 'react-error-boundary';
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { far } from "@fortawesome/free-regular-svg-icons";
import { fab } from "@fortawesome/free-brands-svg-icons";
import { useAppSetting } from "./003_provider/AppSettingProvider";

// Add font awesome icons only once
library.add(fas, far, fab);

// Lazy load heavy components
const Frame = lazy(() => import("./100_components/100_Frame"));

const LoadingSpinner = () => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div>Loading application...</div>
    </div>
);

const MyFallbackComponent = ({ error, resetErrorBoundary }: { error: Error, resetErrorBoundary: () => void }) => {
    console.log("FALLBACK", error);
    return (
        <div role="alert" style={{ padding: '20px', textAlign: 'center' }}>
            <p>Something went wrong.</p>
            <button 
                onClick={() => {
                    resetErrorBoundary();
                    location.reload();
                }}
                style={{ marginTop: '10px', padding: '5px 10px', cursor: 'pointer' }}
            >
                Clear Settings and Reload
            </button>
        </div>
    );
};

const OptimizedApp = React.memo(() => {
    const { applicationSetting } = useAppSetting();

    // Memoize the error boundary props to prevent unnecessary re-renders
    const errorBoundaryProps = useMemo(() => ({
        FallbackComponent: MyFallbackComponent,
        onError: (error: Error, errorInfo: React.ErrorInfo) => {
            console.log(error, errorInfo);
            applicationSetting?.clearSetting();
        },
        onReset: () => {
            console.log("RESET!");
            applicationSetting?.clearSetting();
        }
    }), [applicationSetting]);

    return (
        <ErrorBoundary {...errorBoundaryProps}>
            <div className="application-container">
                <Suspense fallback={<LoadingSpinner />}>
                    <Frame />
                </Suspense>
            </div>
        </ErrorBoundary>
    );
});

export default OptimizedApp;