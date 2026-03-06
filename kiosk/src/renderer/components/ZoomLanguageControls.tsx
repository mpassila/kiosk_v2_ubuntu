import React, { useState, useEffect, useRef } from 'react';
import { Avatar, Badge } from 'antd';
import { MdLanguage, MdAccessibility } from 'react-icons/md';
import { AiOutlinePlusCircle, AiOutlineMinusCircle, AiOutlineClockCircle } from 'react-icons/ai';
import { kioskConfig } from '../state/shared';
import { getFirebaseAuthToken } from '../state/firebase-client';
import HomescreenSlideshow from './HomescreenSlideshow';

interface ZoomLanguageControlsProps {
  languages?: any[];
  showLanguageButton?: boolean;
  showAccessibleModeButton?: boolean;
  showSlideshowButton?: boolean;
  showTimer?: boolean;
  showZoom?: boolean;
  timer?: number;
  deviceId?: string;
  licenseId?: string;
  resetSlideshowTrigger?: number; // Increment this to trigger a reset
  onLanguageClick?: () => void;
  onAccessibleModeClick?: () => void;
  onTimerClick?: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

const ZoomLanguageControls: React.FC<ZoomLanguageControlsProps> = ({
  languages = [],
  showLanguageButton = true,
  showAccessibleModeButton = false,
  showSlideshowButton = false,
  showTimer = false,
  showZoom = true,
  timer = 0,
  deviceId,
  licenseId,
  resetSlideshowTrigger,
  onLanguageClick,
  onAccessibleModeClick,
  onTimerClick,
  onZoomIn,
  onZoomOut
}) => {
  const posterDeviceId = kioskConfig.value?.device?.posters?.bindings?.[0];
  const [showSlideshow, setShowSlideshow] = useState(false);
  const autoStartTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Get homescreen settings from kioskConfig signal (updated via App.tsx RTDB subscription)
  // Use state to avoid reading signal during render
  const [homescreenSettings, setHomescreenSettings] = useState({
    enabled: true,
    startDelay: 10
  });

  // Update homescreen settings from signal or poster device
  useEffect(() => {
    let posterHomescreenData: any = null;
    let posterFetchDone = false;

    const updateSettings = () => {
      // If posterDeviceId is set, wait for its data before applying
      if (posterDeviceId && !posterFetchDone) return;

      // If posterDeviceId is set, use poster device settings and ignore own homescreen
      const homescreen = posterDeviceId ? posterHomescreenData : kioskConfig.value?.device?.homescreen;
      setHomescreenSettings(prev => {
        const hasItems = homescreen?.items && (Array.isArray(homescreen.items) ? homescreen.items.length > 0 : Object.keys(homescreen.items).length > 0);
        const newEnabled = homescreen?.enabled !== false && hasItems;
        const newStartDelay = homescreen?.startDelay || 10;
        if (prev.enabled !== newEnabled || prev.startDelay !== newStartDelay) {
          console.log('🎬 Homescreen settings:', { enabled: newEnabled, startDelay: newStartDelay, hasItems, posterDeviceId: posterDeviceId || 'none' });
          return { enabled: newEnabled, startDelay: newStartDelay };
        }
        return prev;
      });
    };

    const fetchPosterHomescreen = async () => {
      if (posterDeviceId && licenseId) {
        try {
          const baseUrl = `https://library-456310-license${licenseId}-rtdb.firebaseio.com`;
          const authToken = await getFirebaseAuthToken();
          const authParam = authToken ? `?auth=${authToken}` : '';

          // Check if poster device is enabled (online) before using its homescreen
          const onlineUrl = `${baseUrl}/license_${licenseId}/devices/${posterDeviceId}/online.json${authParam}`;
          const onlineResponse = await fetch(onlineUrl);
          const onlineData = await onlineResponse.json();
          if (onlineData === false) {
            console.log(`🎬 Poster device ${posterDeviceId} is disabled — skipping homescreen`);
            posterFetchDone = true;
            updateSettings();
            return;
          }

          console.log('🎬 Fetching poster homescreen from device:', posterDeviceId);
          const url = `${baseUrl}/license_${licenseId}/devices/${posterDeviceId}/homescreen.json${authParam}`;
          const response = await fetch(url);
          const data = await response.json();
          console.log('🎬 Poster homescreen response:', data);
          if (data && !data.error) {
            posterHomescreenData = data;
          }
        } catch (e) {
          console.log('🎬 Failed to fetch poster homescreen:', e);
        }
      }
      posterFetchDone = true;
      updateSettings();
    };

    fetchPosterHomescreen();
    updateSettings();

    const interval = setInterval(updateSettings, 2000);
    return () => clearInterval(interval);
  }, [licenseId, posterDeviceId]);

  const homescreenEnabled = homescreenSettings.enabled;
  const startDelay = homescreenSettings.startDelay;

  // Debug logging for homescreen state
  useEffect(() => {
    console.log('ZoomLanguageControls: homescreen state:', {
      homescreenEnabled: homescreenEnabled,
      startDelay: startDelay,
      showSlideshowButton: showSlideshowButton,
      posterDeviceId: posterDeviceId || 'none'
    });
  }, [homescreenEnabled, startDelay, showSlideshowButton, posterDeviceId]);

  // Handle homescreen enabled changes
  useEffect(() => {
    if (!showSlideshowButton) {
      return;
    }

    // If disabled while slideshow is open, close it immediately
    if (!homescreenEnabled && showSlideshow) {
      console.log('🎬 Homescreen disabled, closing slideshow');
      setShowSlideshow(false);

      // Clear any pending timers
      if (autoStartTimerRef.current) {
        clearTimeout(autoStartTimerRef.current);
        autoStartTimerRef.current = null;
      }
    }
  }, [homescreenEnabled, showSlideshowButton, showSlideshow]);

  // Auto-start slideshow after startDelay when enabled
  useEffect(() => {
    // Only auto-start if slideshow button is shown, enabled, and not currently showing
    if (showSlideshowButton && homescreenEnabled && !showSlideshow && startDelay > 0) {
      // Clear any existing timer
      if (autoStartTimerRef.current) {
        clearTimeout(autoStartTimerRef.current);
      }

      // Start timer to auto-open slideshow
      console.log(`Setting auto-start timer for ${startDelay} seconds (homescreen enabled: ${homescreenEnabled})`);
      autoStartTimerRef.current = setTimeout(() => {
        console.log(`Auto-starting slideshow after ${startDelay} seconds`);
        setShowSlideshow(true);
      }, startDelay * 1000);

      return () => {
        if (autoStartTimerRef.current) {
          clearTimeout(autoStartTimerRef.current);
        }
      };
    }

    // If disabled, ensure no timer is running
    if (!homescreenEnabled && autoStartTimerRef.current) {
      console.log('Homescreen disabled, clearing auto-start timer');
      clearTimeout(autoStartTimerRef.current);
      autoStartTimerRef.current = null;
    }
  }, [showSlideshowButton, homescreenEnabled, showSlideshow, startDelay]);

  // Handle slideshow completion and restart
  const handleSlideshowComplete = () => {
    console.log('Slideshow completed, waiting for restart...');
    setShowSlideshow(false);

    // Only restart if still enabled
    if (!homescreenEnabled) {
      console.log('Homescreen disabled, not restarting slideshow');
      return;
    }

    // Wait for startDelay before restarting
    if (autoStartTimerRef.current) {
      clearTimeout(autoStartTimerRef.current);
    }

    autoStartTimerRef.current = setTimeout(() => {
      console.log(`Restarting slideshow after ${startDelay} seconds`);
      setShowSlideshow(true);
    }, startDelay * 1000);
  };

  const handleManualClose = () => {
    // When manually closed via close button, restart with normal delay
    setShowSlideshow(false);

    // Only restart if still enabled
    if (!homescreenEnabled) {
      console.log('Homescreen disabled, not restarting slideshow');
      return;
    }

    if (autoStartTimerRef.current) {
      clearTimeout(autoStartTimerRef.current);
    }

    autoStartTimerRef.current = setTimeout(() => {
      console.log(`Restarting slideshow after manual close (${startDelay} seconds)`);
      setShowSlideshow(true);
    }, startDelay * 1000);
  };

  const handleTouchClose = () => {
    // When closed by touching the screen, wait 120 seconds
    const extendedDelay = 120;
    console.log(`Screen touched, closing slideshow. Will restart in ${extendedDelay} seconds`);
    setShowSlideshow(false);

    // Only restart if still enabled
    if (!homescreenEnabled) {
      console.log('Homescreen disabled, not restarting slideshow');
      return;
    }

    if (autoStartTimerRef.current) {
      clearTimeout(autoStartTimerRef.current);
    }

    autoStartTimerRef.current = setTimeout(() => {
      console.log(`Restarting slideshow after touch close (${extendedDelay} seconds)`);
      setShowSlideshow(true);
    }, extendedDelay * 1000);
  };

  // Handle external reset trigger (e.g., from UI clicks)
  useEffect(() => {
    if (resetSlideshowTrigger !== undefined && resetSlideshowTrigger > 0 && homescreenEnabled) {
      // Close slideshow if it's open
      if (showSlideshow) {
        console.log('UI click detected, closing slideshow and resetting timer to 120 seconds');
        setShowSlideshow(false);
      } else {
        console.log('UI click detected, resetting slideshow timer to 120 seconds');
      }

      // Reset timer to 120 seconds
      if (autoStartTimerRef.current) {
        clearTimeout(autoStartTimerRef.current);
      }

      autoStartTimerRef.current = setTimeout(() => {
        console.log('Restarting slideshow after UI interaction (120 seconds)');
        setShowSlideshow(true);
      }, 120000); // 120 seconds
    }
  }, [resetSlideshowTrigger, homescreenEnabled, showSlideshow]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoStartTimerRef.current) {
        clearTimeout(autoStartTimerRef.current);
      }
    };
  }, []);

  return (
    <>
      {/* Homescreen Slideshow - Always render when enabled */}
      {showSlideshowButton && homescreenEnabled && (
        <HomescreenSlideshow
          open={showSlideshow}
          onClose={handleManualClose}
          onComplete={handleSlideshowComplete}
          onTouchClose={handleTouchClose}
          deviceId={deviceId || ''}
          licenseId={licenseId || ''}
        />
      )}

      {/* Left controls (language and accessible mode) */}
      <div style={{
        position: 'fixed',
        bottom: '67px',
        left: '20px',
        display: 'flex',
        gap: '10px',
        opacity: 0.8,
        zIndex: 1000
      }}>
        {/* Language button */}
        {showLanguageButton && (
          <Avatar
            onClick={onLanguageClick}
            style={{
              backgroundColor: 'transparent',
              cursor: 'pointer'
            }}
            size={90}
            icon={<MdLanguage size={105} color="white" />}
          />
        )}

        {/* Accessible mode button */}
        {showAccessibleModeButton && (
          <Avatar
            onClick={onAccessibleModeClick}
            style={{
              backgroundColor: 'transparent',
              cursor: 'pointer'
            }}
            size={90}
            icon={<MdAccessibility size={105} color="white" />}
          />
        )}


      </div>

      {/* Right controls (timer and zoom) */}
      <div style={{
        position: 'fixed',
        bottom: '67px',
        right: '20px',
        display: 'flex',
        gap: '10px',
        opacity: 0.8,
        zIndex: 1000,
        alignItems: 'center'
      }}>
        {/* Timer counter - positioned left of clock icon */}
        {showTimer && (
          <span style={{
            color: 'white',
            fontSize: '24px',
            fontWeight: 'bold',
            lineHeight: 1,
            cursor: onTimerClick ? 'pointer' : 'default'
          }} onClick={onTimerClick}>{timer}</span>
        )}
        {showTimer && (
          <AiOutlineClockCircle
            color='white'
            size={90}
            onClick={onTimerClick}
            style={{
              cursor: onTimerClick ? 'pointer' : 'default',
              backgroundColor: 'transparent',
              borderRadius: '50%'
            }}
          />
        )}

        {showZoom && (
          <AiOutlineMinusCircle
            size={90}
            color="white"
            onClick={onZoomOut}
            style={{
              cursor: 'pointer',
              backgroundColor: 'transparent',
              borderRadius: '50%'
            }}
          />
        )}
        {showZoom && (
          <AiOutlinePlusCircle
            size={90}
            color="white"
            onClick={onZoomIn}
            style={{
              cursor: 'pointer',
              backgroundColor: 'transparent',
              borderRadius: '50%'
            }}
          />
        )}
      </div>
    </>
  );
};

export default ZoomLanguageControls;
