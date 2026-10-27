import { Component, ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('App crashed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex items-center justify-center bg-[#F1F0EF] p-4">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h1 className="text-lg font-bold text-gray-800 mb-2">เกิดข้อผิดพลาด</h1>
            <p className="text-sm text-gray-500 mb-4">
              ไม่สามารถโหลดหน้าเว็บได้ อาจเกิดจากเบราว์เซอร์เวอร์ชันเก่า หรือแคชที่ค้างอยู่
            </p>
            <div className="flex flex-col gap-2 items-center">
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 bg-[#F36B21] hover:bg-[#D4591A] text-white text-sm font-bold rounded-xl shadow-md transition-all active:scale-95"
              >
                รีโหลดหน้าเว็บ
              </button>
              <button
                onClick={() => {
                  localStorage.clear();
                  sessionStorage.clear();
                  window.location.reload();
                }}
                className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-bold rounded-xl transition-all active:scale-95"
              >
                ล้างแคชแล้วรีโหลด
              </button>
            </div>
            {this.state.error && (
              <details className="mt-4 text-left">
                <summary className="text-xs text-gray-400 cursor-pointer">รายละเอียดข้อผิดพลาด</summary>
                <pre className="mt-2 text-[10px] text-gray-400 bg-gray-100 p-3 rounded-lg overflow-auto max-h-32">
                  {this.state.error.message}
                  {'\n'}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
