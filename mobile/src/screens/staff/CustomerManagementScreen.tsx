import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState } from '@/components/common';
import { AnimatedPressable, FadeInView, StaffHeader, StatusBadge } from '@/components/staff';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useAppAlert } from '@/contexts/AppAlertContext';
import { useToast } from '@/hooks/useToast';
import type { StaffManagementStackParamList } from '@/navigation/StaffNavigator';
import { staffService, type StaffCustomer } from '@/services/api/staff';

type Props = NativeStackScreenProps<StaffManagementStackParamList, 'Customers'>;

const customerName = (customer: StaffCustomer) =>
  customer.profile?.fullName
  || [customer.profile?.firstName, customer.profile?.lastName].filter(Boolean).join(' ')
  || customer.username
  || 'Customer';

const isCustomerActive = (customer: StaffCustomer) => customer.status !== false;

const formatDate = (value?: string) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export function CustomerManagementScreen({ navigation }: Props) {
  const { t: translateUi } = useLanguage();
  const tabBarHeight = useBottomTabBarHeight();
  const { alert } = useAppAlert();
  const toast = useToast();
  const [customers, setCustomers] = useState<StaffCustomer[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<StaffCustomer | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await staffService.getCustomers();
      setCustomers(response.data ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load customers.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return customers;
    return customers.filter((customer) =>
      [customerName(customer), customer.email, customer.profile?.phone]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalized)),
    );
  }, [customers, query]);

  const fillEditor = (customer: StaffCustomer) => {
    setFirstName(customer.profile?.firstName ?? '');
    setLastName(customer.profile?.lastName ?? '');
    setPhone(customer.profile?.phone ?? '');
  };

  const openCustomer = (customer: StaffCustomer) => {
    setSelectedCustomer(customer);
    setIsEditing(false);
    fillEditor(customer);
  };

  const closeCustomer = () => {
    if (saving || statusSaving) return;
    setSelectedCustomer(null);
    setIsEditing(false);
  };

  const updateCustomerLocally = (updated: StaffCustomer) => {
    setCustomers((current) =>
      current.map((item) => (item._id === updated._id ? updated : item)),
    );
    setSelectedCustomer(updated);
  };

  const saveCustomer = async () => {
    if (!selectedCustomer) return;

    const cleanedFirstName = firstName.trim();
    const cleanedLastName = lastName.trim();
    const cleanedPhone = phone.replace(/[\s-]/g, '');

    if (`${cleanedFirstName}${cleanedLastName}`.length > 50) {
      toast.showError('Name is too long', 'Use no more than 50 characters.');
      return;
    }
    if (cleanedPhone && !/^(03|05|07|08|09)\d{8}$/.test(cleanedPhone)) {
      toast.showError('Invalid phone number', 'Enter a valid Vietnamese phone number.');
      return;
    }

    setSaving(true);
    try {
      const response = await staffService.updateCustomer(selectedCustomer._id, {
        firstName: cleanedFirstName,
        lastName: cleanedLastName,
        phone: cleanedPhone,
      });
      if (response.data) {
        updateCustomerLocally(response.data);
      } else {
        await load();
      }
      setIsEditing(false);
      toast.showSuccess('Customer updated');
    } catch (saveError) {
      toast.showError(
        'Update failed',
        saveError instanceof Error ? saveError.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = (customer: StaffCustomer) => {
    const active = isCustomerActive(customer);
    const nextStatus = !active;
    alert(
      active ? 'Block customer access?' : 'Restore customer access?',
      active
        ? `${customerName(customer)} will no longer be able to access the account.`
        : `${customerName(customer)} will regain access to the account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: active ? 'Block' : 'Restore',
          style: active ? 'destructive' : 'default',
          onPress: async () => {
            setStatusSaving(true);
            try {
              await staffService.updateCustomerStatus(customer._id, nextStatus);
              const updated = { ...customer, status: nextStatus };
              setCustomers((current) =>
                current.map((item) => (item._id === customer._id ? updated : item)),
              );
              setSelectedCustomer((current) =>
                current?._id === customer._id ? { ...current, status: nextStatus } : current,
              );
              toast.showSuccess(nextStatus ? 'Customer restored' : 'Customer blocked');
            } catch (statusError) {
              toast.showError(
                'Status update failed',
                statusError instanceof Error ? statusError.message : undefined,
              );
            } finally {
              setStatusSaving(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <StaffHeader
        title={translateUi("Customers")}
        subtitle={`${customers.length} customers`}
        onBack={() => navigation.navigate('ManagementHome')}
      />

      <FadeInView style={styles.searchWrap}>
        <Ionicons name="search-outline" size={19} color={COLORS.textMuted} />
        <TextInput
          accessibilityLabel={translateUi("Search customers")}
          onChangeText={setQuery}
          placeholder={translateUi("Search name, email or phone")}
          placeholderTextColor={COLORS.textMuted}
          style={styles.searchInput}
          value={query}
        />
        {query ? (
          <TouchableOpacity
            accessibilityLabel={translateUi("Clear search")}
            accessibilityRole="button"
            onPress={() => setQuery('')}
          >
            <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>
        ) : null}
      </FadeInView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      ) : error ? (
        <ErrorState message={translateUi(error)} onRetry={load} />
      ) : (
        <FlatList
          contentContainerStyle={[styles.list, { paddingBottom: tabBarHeight + SPACING.lg }]}
          data={filtered}
          keyExtractor={(item) => item._id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={COLORS.gold}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          renderItem={({ item, index }) => {
            const active = isCustomerActive(item);
            return (
              <FadeInView delay={Math.min(index * 28, 180)}>
                <AnimatedPressable
                  accessibilityLabel={`View ${customerName(item)} details`}
                  row
                  onPress={() => openCustomer(item)}
                >
                  <View style={styles.customerRow}>
                    <CustomerAvatar customer={item} size={46} />
                    <View style={styles.cardCopy}>
                      <Text numberOfLines={1} style={styles.name}>
                        {customerName(item)}
                      </Text>
                      <Text numberOfLines={1} style={styles.email}>
                        {item.email || item.profile?.phone || 'No contact'}
                      </Text>
                    </View>
                    <StatusBadge label={active ? translateUi("Active") : translateUi("Blocked")} tone={active ? 'success' : 'danger'} />
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                  </View>
                </AnimatedPressable>
              </FadeInView>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={translateUi("No customers found")}
              message={translateUi("Try a different search term.")}
            />
          }
        />
      )}

      <CustomerDetailSheet
        customer={selectedCustomer}
        firstName={firstName}
        isEditing={isEditing}
        lastName={lastName}
        phone={phone}
        saving={saving}
        statusSaving={statusSaving}
        onChangeFirstName={setFirstName}
        onChangeLastName={setLastName}
        onChangePhone={setPhone}
        onClose={closeCustomer}
        onEdit={() => {
          if (!selectedCustomer) return;
          fillEditor(selectedCustomer);
          setIsEditing(true);
        }}
        onCancelEdit={() => setIsEditing(false)}
        onSave={() => {
          void saveCustomer();
        }}
        onToggleStatus={() => {
          if (selectedCustomer) toggleStatus(selectedCustomer);
        }}
      />
    </SafeAreaView>
  );
}

function CustomerDetailSheet({
  customer,
  firstName,
  isEditing,
  lastName,
  phone,
  saving,
  statusSaving,
  onChangeFirstName,
  onChangeLastName,
  onChangePhone,
  onClose,
  onEdit,
  onCancelEdit,
  onSave,
  onToggleStatus,
}: {
  customer: StaffCustomer | null;
  firstName: string;
  isEditing: boolean;
  lastName: string;
  phone: string;
  saving: boolean;
  statusSaving: boolean;
  onChangeFirstName: (value: string) => void;
  onChangeLastName: (value: string) => void;
  onChangePhone: (value: string) => void;
  onClose: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onToggleStatus: () => void;
}) {
  const { t: translateUi } = useLanguage();
  const active = customer ? isCustomerActive(customer) : false;
  const username = customer?.username || customer?.email.split('@')[0] || 'customer';

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={Boolean(customer)}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel={translateUi("Close customer details")}
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {isEditing ? translateUi("Edit customer") : 'Customer detail'}
            </Text>
            <TouchableOpacity
              accessibilityLabel={translateUi("Close customer details")}
              accessibilityRole="button"
              onPress={onClose}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={21} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {customer ? (
            <>
              <ScrollView
                contentContainerStyle={styles.sheetBody}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {!isEditing ? (
                  <>
                    <View style={styles.profileHero}>
                      <View style={styles.avatarWrap}>
                        <CustomerAvatar customer={customer} size={82} />
                        <View
                          style={[
                            styles.presenceDot,
                            !active && styles.presenceDotBlocked,
                          ]}
                        />
                      </View>
                      <Text style={styles.profileName}>{customerName(customer)}</Text>
                      <Text style={styles.username}>@{username}</Text>
                      <View style={styles.badges}>
                        <View style={styles.roleBadge}>
                          <View style={styles.roleDot} />
                          <Text style={styles.roleText}>{translateUi("Customer")}</Text>
                        </View>
                        <View
                          style={[
                            styles.activeBadge,
                            !active && styles.blockedBadge,
                          ]}
                        >
                          <View
                            style={[
                              styles.activeDot,
                              !active && styles.blockedDot,
                            ]}
                          />
                          <Text
                            style={[
                              styles.activeText,
                              !active && styles.blockedText,
                            ]}
                          >
                            {active ? translateUi("Active") : translateUi("Blocked")}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.infoCard}>
                      <Text style={styles.cardTitle}>{translateUi("Basic info")}</Text>
                      <CustomerInfoRow
                        icon="mail-outline"
                        label={translateUi("Email address")}
                        value={customer.email}
                      />
                      <CustomerInfoRow
                        icon="call-outline"
                        label={translateUi("Phone number")}
                        value={customer.profile?.phone || 'Not provided'}
                      />
                      <CustomerInfoRow
                        icon="calendar-outline"
                        label={translateUi("Join date")}
                        value={formatDate(customer.createdAt)}
                      />
                    </View>

                    <View style={styles.infoCard}>
                      <Text style={styles.cardTitle}>{translateUi("Account activity")}</Text>
                      <ActivityItem
                        color="#34D399"
                        label={translateUi("Account created")}
                        value={formatDate(customer.createdAt)}
                      />
                      <ActivityItem
                        color={COLORS.gold}
                        label={translateUi("Last updated")}
                        value={formatDate(customer.updatedAt)}
                        last
                      />
                    </View>
                  </>
                ) : (
                  <View style={styles.editSection}>
                    <View style={styles.editCustomerHeader}>
                      <CustomerAvatar customer={customer} size={54} />
                      <View style={styles.editCustomerCopy}>
                        <Text style={styles.editCustomerName}>
                          {customerName(customer)}
                        </Text>
                        <Text numberOfLines={1} style={styles.editCustomerEmail}>
                          {customer.email}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.cardTitle}>{translateUi("Edit basic info")}</Text>
                    <Text style={styles.label}>{translateUi("First name")}</Text>
                    <TextInput
                      value={firstName}
                      onChangeText={onChangeFirstName}
                      style={styles.input}
                      placeholder={translateUi("First name")}
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <Text style={styles.label}>{translateUi("Last name")}</Text>
                    <TextInput
                      value={lastName}
                      onChangeText={onChangeLastName}
                      style={styles.input}
                      placeholder={translateUi("Last name")}
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <Text style={styles.label}>{translateUi("Phone number")}</Text>
                    <TextInput
                      value={phone}
                      onChangeText={onChangePhone}
                      style={styles.input}
                      keyboardType="phone-pad"
                      placeholder="0901234567"
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <View style={styles.roleLock}>
                      <Ionicons name="shield-checkmark-outline" size={18} color={COLORS.gold} />
                      <View style={styles.roleLockCopy}>
                        <Text style={styles.roleLockLabel}>{translateUi("Customer role")}</Text>
                        <Text style={styles.roleLockHint}>
                          {" "}{translateUi("Staff cannot change account roles.")}{" "}</Text>
                      </View>
                      <Ionicons name="lock-closed" size={15} color={COLORS.textMuted} />
                    </View>
                  </View>
                )}
              </ScrollView>

              <View style={styles.sheetFooter}>
                {isEditing ? (
                  <>
                    <TouchableOpacity
                      disabled={saving}
                      onPress={onCancelEdit}
                      style={[styles.footerButton, styles.cancelButton]}
                    >
                      <Text style={styles.cancelText}>{translateUi("Cancel")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={saving}
                      onPress={onSave}
                      style={[styles.footerButton, styles.saveButton, saving && styles.disabled]}
                    >
                      {saving ? (
                        <ActivityIndicator color={COLORS.textInverse} />
                      ) : (
                        <Text style={styles.saveText}>{translateUi("Save changes")}</Text>
                      )}
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      disabled={statusSaving}
                      onPress={onEdit}
                      style={[styles.footerButton, styles.editButton]}
                    >
                      <Text style={styles.editButtonText}>{translateUi("Edit customer")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={statusSaving}
                      onPress={onToggleStatus}
                      style={[
                        styles.footerButton,
                        styles.blockButton,
                        !active && styles.restoreButton,
                        statusSaving && styles.disabled,
                      ]}
                    >
                      {statusSaving ? (
                        <ActivityIndicator color={active ? COLORS.error : COLORS.success} />
                      ) : (
                        <Text
                          style={[
                            styles.blockButtonText,
                            !active && styles.restoreButtonText,
                          ]}
                        >
                          {active ? 'Block customer' : 'Unblock customer'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function CustomerAvatar({
  customer,
  size,
}: {
  customer: StaffCustomer;
  size: number;
}) {
  const avatar = customer.profile?.avatar;
  if (avatar) {
    return (
      <Image
        accessibilityLabel={`${customerName(customer)} avatar`}
        source={{ uri: avatar }}
        style={{ borderRadius: size / 2, height: size, width: size }}
      />
    );
  }
  return (
    <View
      style={[
        styles.avatar,
        {
          borderRadius: size / 2,
          height: size,
          width: size,
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: Math.max(17, size * 0.36) }]}>
        {customerName(customer).charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

function CustomerInfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const { t: translateUi } = useLanguage();
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={17} color={COLORS.textMuted} />
      </View>
      <View style={styles.infoCopy}>
        <Text style={styles.infoLabel}>{translateUi(label)}</Text>
        <Text numberOfLines={2} style={styles.infoValue}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function ActivityItem({
  color,
  label,
  value,
  last = false,
}: {
  color: string;
  label: string;
  value: string;
  last?: boolean;
}) {
  const { t: translateUi } = useLanguage();
  return (
    <View style={styles.activityRow}>
      <View style={styles.activityRail}>
        <View style={[styles.activityRing, { backgroundColor: `${color}18` }]}>
          <View style={[styles.activityDot, { backgroundColor: color }]} />
        </View>
        {!last ? <View style={styles.activityLine} /> : null}
      </View>
      <View style={styles.activityCopy}>
        <Text style={styles.activityLabel}>{translateUi(label)}</Text>
        <Text style={styles.activityDate}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.background, flex: 1 },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  searchWrap: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    minHeight: 50,
    paddingHorizontal: SPACING.sm,
  },
  searchInput: { color: COLORS.textPrimary, flex: 1, fontSize: FONT_SIZES.sm },
  list: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  customerRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 78,
    paddingVertical: SPACING.sm,
  },
  card: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    padding: SPACING.md,
  },
  pressed: { backgroundColor: COLORS.surfaceElevated, transform: [{ scale: 0.99 }] },
  avatar: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.14)',
    justifyContent: 'center',
  },
  avatarText: { color: COLORS.gold, fontWeight: '800' },
  cardCopy: { flex: 1, minWidth: 0 },
  name: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '700' },
  email: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginTop: 2 },
  phone: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  status: {
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderRadius: RADIUS.round,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
  },
  statusBlocked: { backgroundColor: 'rgba(255,77,77,0.12)' },
  statusText: { color: COLORS.success, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  statusTextBlocked: { color: COLORS.error },
  overlay: {
    backgroundColor: 'rgba(2,5,9,0.72)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1B2027',
    borderColor: COLORS.border,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    maxHeight: '92%',
    minHeight: '72%',
    overflow: 'hidden',
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: COLORS.borderLight,
    borderRadius: 2,
    height: 4,
    marginTop: SPACING.sm,
    width: 38,
  },
  sheetHeader: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  sheetTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: RADIUS.round,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  sheetBody: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  profileHero: { alignItems: 'center', paddingBottom: SPACING.lg },
  avatarWrap: { marginBottom: SPACING.sm, position: 'relative' },
  presenceDot: {
    backgroundColor: '#34D399',
    borderColor: '#1B2027',
    borderRadius: 9,
    borderWidth: 3,
    bottom: 2,
    height: 18,
    position: 'absolute',
    right: 2,
    width: 18,
  },
  presenceDotBlocked: { backgroundColor: COLORS.error },
  profileName: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xl,
    fontWeight: '800',
  },
  username: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm, marginTop: 2 },
  badges: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  roleBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.1)',
    borderColor: 'rgba(226,186,75,0.35)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  roleDot: { backgroundColor: COLORS.gold, borderRadius: 3, height: 6, width: 6 },
  roleText: { color: COLORS.goldLight, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  activeBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(52,211,153,0.1)',
    borderColor: 'rgba(52,211,153,0.3)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  blockedBadge: {
    backgroundColor: 'rgba(255,77,77,0.1)',
    borderColor: 'rgba(255,77,77,0.3)',
  },
  activeDot: { backgroundColor: '#34D399', borderRadius: 3, height: 6, width: 6 },
  blockedDot: { backgroundColor: COLORS.error },
  activeText: { color: '#34D399', fontSize: FONT_SIZES.xs, fontWeight: '700' },
  blockedText: { color: COLORS.error },
  infoCard: {
    backgroundColor: '#171B20',
    borderColor: 'rgba(255,255,255,0.04)',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.md,
    padding: SPACING.md,
  },
  cardTitle: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
  },
  infoRow: { alignItems: 'center', flexDirection: 'row', marginTop: SPACING.sm },
  infoIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: RADIUS.sm,
    height: 38,
    justifyContent: 'center',
    marginRight: SPACING.sm,
    width: 38,
  },
  infoCopy: { flex: 1 },
  infoLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  infoValue: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
    marginTop: 1,
  },
  activityRow: { flexDirection: 'row', minHeight: 62 },
  activityRail: { alignItems: 'center', width: 28 },
  activityRing: {
    alignItems: 'center',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  activityDot: { borderRadius: 3, height: 6, width: 6 },
  activityLine: {
    backgroundColor: COLORS.borderLight,
    flex: 1,
    marginVertical: 3,
    width: 1,
  },
  activityCopy: { paddingLeft: SPACING.sm, paddingTop: 2 },
  activityLabel: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  activityDate: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 3 },
  editSection: { paddingBottom: SPACING.sm },
  editCustomerHeader: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginBottom: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  editCustomerCopy: { flex: 1, marginLeft: SPACING.md },
  editCustomerName: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '700' },
  editCustomerEmail: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  label: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: SPACING.sm,
  },
  input: {
    fontSize: FONT_SIZES.md,
    paddingVertical: 12,
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    color: COLORS.textPrimary,
    minHeight: 50,
    paddingHorizontal: SPACING.md,
  },
  roleLock: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: SPACING.lg,
    padding: SPACING.md,
  },
  roleLockCopy: { flex: 1, marginLeft: SPACING.sm },
  roleLockLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  roleLockHint: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  sheetFooter: {
    backgroundColor: 'rgba(23,27,32,0.98)',
    borderTopColor: COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  footerButton: {
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: SPACING.sm,
  },
  editButton: {
    backgroundColor: 'rgba(226,186,75,0.06)',
    borderColor: 'rgba(226,186,75,0.4)',
  },
  editButtonText: { color: COLORS.goldLight, fontSize: FONT_SIZES.sm, fontWeight: '700' },
  blockButton: {
    backgroundColor: 'rgba(255,77,77,0.05)',
    borderColor: 'rgba(255,77,77,0.4)',
  },
  blockButtonText: { color: COLORS.error, fontSize: FONT_SIZES.sm, fontWeight: '700' },
  restoreButton: {
    backgroundColor: 'rgba(76,175,80,0.06)',
    borderColor: 'rgba(76,175,80,0.4)',
  },
  restoreButtonText: { color: COLORS.success },
  cancelButton: { borderColor: COLORS.borderLight },
  cancelText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '700' },
  saveButton: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  saveText: { color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '800' },
  disabled: { opacity: 0.55 },
});
