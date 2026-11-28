import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../services/api';
import { useSocket } from './useSocket';
import { DEFAULT_CAMERA_CONFIG, normalizeCameraConfig } from '../utils/cameraLaneCapture';

const STORAGE_KEY = 'valo_gate_camera_config';
const CHANNEL_NAME = 'valo_gate_camera_config_channel';

const readStoredConfig = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeCameraConfig(JSON.parse(raw)) : { ...DEFAULT_CAMERA_CONFIG };
  } catch {
    return { ...DEFAULT_CAMERA_CONFIG };
  }
};

const writeStoredConfig = (config) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota errors
  }
};

export function useGateCameraConfig() {
  const socket = useSocket();
  const [cameraConfig, setCameraConfig] = useState(readStoredConfig);
  const [isSaving, setIsSaving] = useState(false);
  const configRef = useRef(cameraConfig);

  useEffect(() => {
    configRef.current = cameraConfig;
  }, [cameraConfig]);

  useEffect(() => {
    let active = true;

    const loadInitial = async () => {
      try {
        const res = await fetch(`${API_BASE}/iot/camera-config`);
        const json = await res.json();
        if (active && res.ok && json?.success && json.data) {
          const normalized = normalizeCameraConfig(json.data);
          setCameraConfig(normalized);
          writeStoredConfig(normalized);
        }
      } catch {
        // Keep local fallback when offline
      }
    };
    loadInitial();

    const handleStorage = (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          setCameraConfig(normalizeCameraConfig(JSON.parse(event.newValue)));
        } catch {
          // Ignore malformed payload
        }
      }
    };
    window.addEventListener('storage', handleStorage);

    let channel = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        if (event.data) {
          const normalized = normalizeCameraConfig(event.data);
          setCameraConfig(normalized);
          writeStoredConfig(normalized);
        }
      };
    }

    return () => {
      active = false;
      window.removeEventListener('storage', handleStorage);
      if (channel) channel.close();
    };
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const handleRemoteConfig = (incoming) => {
      if (!incoming) return;
      const normalized = normalizeCameraConfig(incoming);
      setCameraConfig(normalized);
      writeStoredConfig(normalized);
    };
    socket.on('gate:camera_config', handleRemoteConfig);
    return () => socket.off('gate:camera_config', handleRemoteConfig);
  }, [socket]);

  const updateCameraConfig = useCallback(async (patchOrUpdater) => {
    const current = configRef.current;
    const nextRaw = typeof patchOrUpdater === 'function'
      ? patchOrUpdater(current)
      : { ...current, ...patchOrUpdater };
    const nextConfig = normalizeCameraConfig(nextRaw);

    setCameraConfig(nextConfig);
    writeStoredConfig(nextConfig);

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const channel = new BroadcastChannel(CHANNEL_NAME);
        channel.postMessage(nextConfig);
        channel.close();
      } catch {
        // Ignore broadcast error
      }
    }

    const token = localStorage.getItem('accessToken');
    if (!token) return nextConfig;

    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/iot/camera-config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(nextConfig),
      });
      const json = await res.json();
      if (res.ok && json?.success && json.data) {
        const synced = normalizeCameraConfig(json.data);
        setCameraConfig(synced);
        writeStoredConfig(synced);
        return synced;
      }
    } catch (err) {
      console.warn('Failed to persist camera config:', err);
    } finally {
      setIsSaving(false);
    }

    return nextConfig;
  }, []);

  return { cameraConfig, updateCameraConfig, isSaving };
}

