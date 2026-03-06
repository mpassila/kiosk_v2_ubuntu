import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Modal } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { getFirebaseAuthToken } from '../state/firebase-client';
import { slideshowActive } from '../state/shared';

interface HomescreenItem {
  type: 'image' | 'video' | 'timeout';
  url?: string;
  selectedFile?: string;
  name?: string;
  description?: string;
  duration?: number;
  enabled?: boolean;
  color?: string;
  weekdays?: string; // e.g. "MON", "TUE", "MON,WED,FRI"
  allDay?: boolean; // true = show all day, false = use startTime/endTime
  startTime?: string; // e.g. "08:00"
  endTime?: string; // e.g. "17:00"
}

interface HomescreenSlideshowProps {
  open: boolean;
  onClose: () => void;
  onComplete?: () => void;
  onTouchClose?: () => void;
  deviceId: string;
  licenseId: string;
}

// Color name mapper for common Tailwind/custom color names
const colorNameMap: Record<string, string> = {
  'emerald': '#10b981',
  'green': '#22c55e',
  'blue': '#3b82f6',
  'red': '#ef4444',
  'yellow': '#eab308',
  'purple': '#a855f7',
  'pink': '#ec4899',
  'orange': '#f97316',
  'cyan': '#06b6d4',
  'teal': '#14b8a6',
  'indigo': '#6366f1',
  'violet': '#8b5cf6',
  'fuchsia': '#d946ef',
  'rose': '#f43f5e',
  'lime': '#84cc16',
  'amber': '#f59e0b',
  'sky': '#0ea5e9',
  'slate': '#64748b',
  'gray': '#6b7280',
  'white': '#ffffff',
  'black': '#000000'
};

const HomescreenSlideshow: React.FC<HomescreenSlideshowProps> = ({
  open,
  onClose,
  onComplete,
  onTouchClose,
  deviceId,
  licenseId
}) => {
  const [items, setItems] = useState<HomescreenItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasCompletedCycle, setHasCompletedCycle] = useState(false);

  // Helper function to resolve color
  const resolveColor = (color?: string): string => {
    if (!color) return '#ffffff';
    // If it starts with #, it's already a hex code
    if (color.startsWith('#')) return color;
    // Otherwise look it up in the map
    return colorNameMap[color.toLowerCase()] || color;
  };

  // Get current weekday abbreviation: SUN, MON, TUE, WED, THU, FRI, SAT
  const getCurrentWeekday = (): string => {
    return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date().getDay()];
  };

  // Parse homescreen data into an array of items, filtering by enabled and weekday
  const parseHomescreenItems = (data: any): HomescreenItem[] => {
    if (!data) return [];
    let itemsArray: HomescreenItem[];
    if (data.items) {
      // Items nested under 'items' key — array or RTDB object with numeric keys
      itemsArray = Array.isArray(data.items) ? data.items : Object.values(data.items);
    } else if (Array.isArray(data)) {
      itemsArray = data;
    } else if (typeof data === 'object') {
      itemsArray = Object.values(data);
    } else {
      return [];
    }
    // Filter out non-object entries (e.g. stray scalars from RTDB)
    itemsArray = itemsArray.filter((item: any) => item && typeof item === 'object');
    const today = getCurrentWeekday();
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return itemsArray.filter((item: any) => {
      if (!item || item.enabled === false) return false;
      // If weekdays is set, only show on matching days
      if (item.weekdays) {
        let days: string[] = [];
        if (typeof item.weekdays === 'string') {
          days = item.weekdays.toUpperCase().split(',').map((d: string) => d.trim());
        } else if (Array.isArray(item.weekdays)) {
          days = item.weekdays.map((d: any) => String(d).toUpperCase().trim());
        } else if (typeof item.weekdays === 'object') {
          days = Object.values(item.weekdays).map((d: any) => String(d).toUpperCase().trim());
        }
        if (days.length > 0 && !days.includes(today)) {
          console.log(`🎬 Skipping slide "${item.name || 'unnamed'}" — weekdays: ${JSON.stringify(item.weekdays)}, today: ${today}`);
          return false;
        }
      }
      // If allDay is false, check startTime/endTime
      if (item.allDay === false && item.startTime && item.endTime) {
        const [startH, startM] = item.startTime.split(':').map(Number);
        const [endH, endM] = item.endTime.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        if (nowMinutes < startMinutes || nowMinutes > endMinutes) {
          console.log(`🎬 Skipping slide "${item.name || 'unnamed'}" — time: ${item.startTime}-${item.endTime}, now: ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`);
          return false;
        }
      }
      return true;
    }) as HomescreenItem[];
  };

  // Fetch homescreen data from Firebase
  // Supports multiple poster bindings: fetches items from all bound devices and combines into one carousel
  useEffect(() => {
    if (open && deviceId && licenseId) {
      const fetchHomescreen = async () => {
        try {
          setLoading(true);
          const baseUrl = `https://library-456310-license${licenseId}-rtdb.firebaseio.com`;
          const authToken = await getFirebaseAuthToken();
          const authParam = authToken ? `?auth=${authToken}` : '';

          // Check for poster bindings
          let targetDeviceIds: string[] = [];
          try {
            const postersUrl = `${baseUrl}/license_${licenseId}/devices/${deviceId}/posters.json${authParam}`;
            const postersResponse = await fetch(postersUrl);
            const postersData = await postersResponse.json();
            if (postersData?.bindings && Array.isArray(postersData.bindings) && postersData.bindings.length > 0) {
              targetDeviceIds = postersData.bindings;
              console.log(`🎬 Poster bindings found: ${targetDeviceIds.join(', ')}`);
            }
          } catch (e) {
            console.log('🎬 No poster bindings found, using own homescreen');
          }

          // If no bindings, use own device
          if (targetDeviceIds.length === 0) {
            targetDeviceIds = [deviceId];
          }

          // Fetch homescreen items from all bound devices in parallel
          // Skip devices that are disabled (online: false)
          const allItems: HomescreenItem[] = [];
          const fetchPromises = targetDeviceIds.map(async (targetId) => {
            try {
              // Check if poster device is enabled (online) before fetching its items
              if (targetId !== deviceId) {
                const onlineUrl = `${baseUrl}/license_${licenseId}/devices/${targetId}/online.json${authParam}`;
                const onlineResponse = await fetch(onlineUrl);
                const onlineData = await onlineResponse.json();
                if (onlineData === false) {
                  console.log(`🎬 Poster device ${targetId} is disabled — skipping`);
                  return [];
                }
              }

              const url = `${baseUrl}/license_${licenseId}/devices/${targetId}/homescreen.json${authParam}`;
              const response = await fetch(url);
              const data = await response.json();
              if (data && !data.error) {
                if (data.enabled === false) {
                  console.log(`🎬 Device ${targetId} homescreen is disabled — skipping`);
                  return [];
                }
                const items = parseHomescreenItems(data);
                console.log(`🎬 Device ${targetId}: ${items.length} enabled homescreen items`);
                return items;
              }
            } catch (e) {
              console.log(`🎬 Failed to fetch homescreen from device ${targetId}:`, e);
            }
            return [];
          });

          const results = await Promise.all(fetchPromises);
          for (const deviceItems of results) {
            allItems.push(...deviceItems);
          }

          console.log(`🎬 Total combined homescreen items: ${allItems.length} from ${targetDeviceIds.length} device(s)`);
          setItems(allItems);
          setCurrentIndex(0);
        } catch (error) {
          console.error('Error fetching homescreen data:', error);
          setItems([]);
        } finally {
          setLoading(false);
        }
      };

      fetchHomescreen();
    }
  }, [open, deviceId, licenseId]);

  // Auto-rotate preview slideshow
  useEffect(() => {
    if (!open || items.length === 0) {
      setCurrentIndex(0);
      setHasCompletedCycle(false);
      return;
    }

    // Get current slide's duration or default to 5 seconds
    const currentSlide = items[currentIndex];
    const duration = (currentSlide?.duration || 5) * 1000; // Convert to milliseconds

    const timeout = setTimeout(() => {
      const nextIndex = (currentIndex + 1) % items.length;

      // Check if we're completing a full cycle (going back to 0)
      if (nextIndex === 0 && currentIndex === items.length - 1) {
        console.log('Slideshow cycle completed');
        setHasCompletedCycle(true);
        // Call onComplete after a brief delay to show the last slide
        setTimeout(() => {
          if (onComplete) {
            onComplete();
          }
        }, 500);
      } else {
        setCurrentIndex(nextIndex);
      }
    }, duration);

    return () => clearTimeout(timeout);
  }, [open, items.length, currentIndex, items, onComplete]);

  // Track slideshow active state and cleanup on close
  useEffect(() => {
    const isActive = open && !loading && items.length > 0;
    slideshowActive.value = isActive;
    if (!open) {
      setCurrentIndex(0);
      setHasCompletedCycle(false);
    }
    return () => { slideshowActive.value = false; };
  }, [open, loading, items.length]);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        console.log('Escape key pressed, closing slideshow');
        onClose();
      }
    };

    if (open) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, onClose]);

  const renderCurrentItem = () => {
    const currentItem = items[currentIndex];

    if (!currentItem) {
      return null;
    }

    const mediaUrl = currentItem.selectedFile || currentItem.url;

    // Debug logging for color
    console.log(`🎨 Slide ${currentIndex + 1}: type=${currentItem.type}, color=${currentItem.color}, name=${currentItem.name}`);

    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative'
      }}>
        {currentItem.type === 'timeout' ? (
          // Timeout type - show transparent/see-through
          <div style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}></div>
        ) : currentItem.type === 'image' ? (
          mediaUrl ? (
            <img
              src={mediaUrl}
              alt={currentItem.name || 'Slideshow item'}
              style={{
                maxWidth: '100%',
                maxHeight: 'calc(100vh - 40px)',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                display: 'block'
              }}
            />
          ) : (
            <div style={{ color: '#9ca3af', textAlign: 'center' }}>
              <p>No image URL set</p>
            </div>
          )
        ) : (
          mediaUrl ? (
            <video
              key={currentIndex}
              autoPlay
              loop
              muted
              playsInline
              style={{
                maxWidth: '100%',
                maxHeight: 'calc(100vh - 40px)',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                display: 'block'
              }}
            >
              <source src={mediaUrl} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          ) : (
            <div style={{ color: '#9ca3af', textAlign: 'center' }}>
              <p>No video URL set</p>
            </div>
          )
        )}

        {/* Title overlay on top of image/video - not for timeout */}
        {currentItem.type !== 'timeout' && currentItem.name && (
          <div style={{
            position: 'absolute',
            top: '100px',
            left: 0,
            right: 0,
            backgroundColor: 'transparent',
            padding: '30px',
            zIndex: 10
          }}>
            <h2
              style={{
                fontSize: '64px',
                fontWeight: 'bold',
                textAlign: 'center',
                color: resolveColor(currentItem.color),
                textShadow: '2px 2px 8px rgba(0, 0, 0, 0.8)'
              }}
            >
              {currentItem.name}
            </h2>
          </div>
        )}

        {/* Description overlay on bottom of image/video - not for timeout */}
        {currentItem.type !== 'timeout' && currentItem.description && (
          <div style={{
            position: 'absolute',
            bottom: '100px',
            left: 0,
            right: 0,
            backgroundColor: 'transparent',
            padding: '30px',
            zIndex: 10
          }}>
            <p
              style={{
                fontSize: '36px',
                textAlign: 'center',
                color: resolveColor(currentItem.color),
                textShadow: '2px 2px 8px rgba(0, 0, 0, 0.8)'
              }}
            >
              {currentItem.description}
            </p>
          </div>
        )}

        {/* Item info overlay */}
        <div style={{
          position: 'absolute',
          bottom: '16px',
          right: '16px',
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          color: resolveColor(currentItem.color),
          padding: '6px 12px',
          borderRadius: '8px',
          fontSize: '12px'
        }}>
          <div style={{ fontWeight: '600' }}>
            Slide {currentIndex + 1}/{items.length}
          </div>
          <div style={{ opacity: 0.8 }}>
            {currentItem.duration || 5}s
          </div>
        </div>
      </div>
    );
  };

  if (!open || loading || items.length === 0) {
    return null;
  }

  const currentItem = items[currentIndex];
  const isTimeout = currentItem?.type === 'timeout';

  const handleScreenTouch = (e: React.MouseEvent) => {
    // Any touch on the screen (except close button) should trigger touch close
    console.log('Screen touched, closing slideshow with extended delay');
    if (onTouchClose) {
      onTouchClose();
    } else {
      onClose();
    }
  };

  const handleCloseClick = (e: React.MouseEvent) => {
    console.log('Close button clicked');
    e.stopPropagation();
    onClose();
  };

  const modalContent = (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: isTimeout ? 'transparent' : '#000',
      zIndex: 999999,
      overflow: 'hidden',
      cursor: 'pointer'
    }}
    onClick={handleScreenTouch}
    onTouchEnd={handleScreenTouch}
    >

      {/* Close button */}
      <button
        onClick={handleCloseClick}
        onTouchEnd={(e) => {
          e.stopPropagation();
          handleCloseClick(e as any);
        }}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          zIndex: 1000001,
          cursor: 'pointer',
          backgroundColor: 'rgba(255, 0, 0, 0.9)',
          border: '4px solid white',
          borderRadius: '50%',
          width: '80px',
          height: '80px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          fontSize: '40px',
          color: 'white',
          fontWeight: 'bold',
          transition: 'all 0.3s',
          boxShadow: '0 4px 12px rgba(0,0,0,0.7)',
          pointerEvents: 'auto',
          userSelect: 'none'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 0, 0, 1)';
          e.currentTarget.style.transform = 'scale(1.15)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 0, 0, 0.9)';
          e.currentTarget.style.transform = 'scale(1)';
        }}
        type="button"
        aria-label="Close slideshow"
      >
        ✕
      </button>

      {/* Slideshow content */}
      <div style={{
        width: '100%',
        height: '100%',
        backgroundColor: isTimeout ? 'transparent' : '#000',
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 999990
      }}>
        {renderCurrentItem()}
      </div>

      {/* Progress indicator */}
      {!loading && items.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: '40px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: '15px',
          zIndex: 1000000
        }}>
          {items.map((_, index) => (
            <div
              key={index}
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                backgroundColor: index === currentIndex ? '#00ff00' : 'rgba(255, 255, 255, 0.5)',
                border: '2px solid white',
                transition: 'background-color 0.3s'
              }}
            />
          ))}
        </div>
      )}
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default HomescreenSlideshow;
