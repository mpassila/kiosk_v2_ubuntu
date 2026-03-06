import { useState, useCallback } from 'react';

export function useSlideshowReset() {
  const [slideshowResetTrigger, setSlideshowResetTrigger] = useState(0);
  const triggerSlideshowReset = useCallback(() => {
    setSlideshowResetTrigger(prev => prev + 1);
  }, []);
  return { slideshowResetTrigger, triggerSlideshowReset };
}
