import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'حدث خطأ غير متوقع في التطبيق.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Application ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] p-6" dir="rtl">
          <div className="max-w-md w-full bg-white border border-[#E8EAED] rounded-2xl p-6 text-center space-y-4">
            <h2 className="font-display text-lg font-bold text-[#202124]">
              تعذر إكمال العملية
            </h2>
            <p className="text-sm text-[#5F6368]">
              حدث خطأ غير متوقع أثناء تشغيل الواجهة. يمكنك إعادة تحميل الصفحة للمتابعة.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-[#01875F] hover:bg-[#016E4D] rounded-xl transition-colors"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
