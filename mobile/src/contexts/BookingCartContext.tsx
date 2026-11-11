import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as Crypto from 'expo-crypto';
import { useAuth } from '@/hooks/useAuth';
import { getCartConflict, type BookingCartItem } from '@/utils/bookingCart';

interface CartContextValue {
  items: BookingCartItem[];
  add: (item: BookingCartItem) => void;
  remove: (id: string) => void;
  clear: () => void;
  checkoutKey: string;
}
const Context = createContext<CartContextValue | null>(null);

export function BookingCartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<BookingCartItem[]>([]);
  const current = useRef(items);
  const [checkoutKey, setCheckoutKey] = useState(() => Crypto.randomUUID());
  const replace = useCallback((next: BookingCartItem[]) => {
    current.current = next;
    setItems(next);
    setCheckoutKey(Crypto.randomUUID());
  }, []);
  useEffect(() => {
    replace([]);
  }, [user?.id, replace]);
  const add = useCallback(
    (item: BookingCartItem) => {
      const conflict = getCartConflict(current.current, item);
      if (conflict) throw new Error(conflict);
      replace([...current.current, item]);
    },
    [replace],
  );
  const value = useMemo(
    () => ({
      items,
      add,
      checkoutKey,
      remove: (id: string) => replace(current.current.filter((item) => item.clientItemId !== id)),
      clear: () => replace([]),
    }),
    [items, add, checkoutKey, replace],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBookingCart() {
  const value = useContext(Context);
  if (!value) throw new Error('BookingCartProvider is required.');
  return value;
}
