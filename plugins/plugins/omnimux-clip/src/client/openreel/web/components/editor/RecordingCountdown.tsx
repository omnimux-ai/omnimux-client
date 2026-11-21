import React, { useState, useEffect } from "react";
import { useClipT } from "../../../../i18n/index.js";
import "./recording-countdown.css";

export const RecordingCountdown: React.FC = () => {
  const t = useClipT();
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (count > 0) {
      const timer = setTimeout(() => setCount(count - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [count]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-md">
      <div className="relative">
        <div
          key={count}
          className="clip-recording-countdown text-[180px] font-bold text-white"
        >
          {count > 0 ? count : ""}
        </div>

        {count === 0 && (
          <div className="clip-recording-start flex flex-col items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-error rounded-full animate-pulse" />
              <span className="text-2xl font-bold text-white">
                {t("Recording...")}
              </span>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
