import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AssistantChat, { ChatItem } from './AssistantChat';

/**
 * Boton flotante del asistente (Cerberus Managers). Queda encima de
 * cualquier pantalla y abre el chat como una ventana que sube desde abajo.
 * La conversacion vive aqui, asi que cerrar la ventana no la borra: sigue
 * ahi al volver a abrirla (se pierde solo al cerrar sesion o la app).
 */
export default function AssistantFab() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  // Autorizaciones que el asistente dejo listas y nadie ha confirmado ni cancelado.
  const waiting = items.filter((item) => item.proposal && (item.proposalState === 'pending' || item.proposalState === 'failed')).length;

  return (
    <>
      <TouchableOpacity
        style={[styles.fab, { bottom: 20 + insets.bottom }]}
        onPress={() => setOpen(true)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Abrir el asistente"
      >
        <Text style={styles.fabText}>Asistente</Text>
        {waiting > 0 && (
          <View style={styles.fabBadge}>
            <Text style={styles.fabBadgeText}>{waiting}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          {/* Tocar por fuera de la ventana la cierra. */}
          <Pressable style={styles.backdropTouch} onPress={() => setOpen(false)} accessibilityLabel="Cerrar el asistente" />
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>Asistente</Text>
                <Text style={styles.headerSubtitle}>Horas extra y novedades</Text>
              </View>
              {items.length > 0 && (
                <TouchableOpacity onPress={() => setItems([])} hitSlop={10} style={styles.headerAction}>
                  <Text style={styles.headerActionText}>Nueva charla</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10} style={styles.closeButton} accessibilityLabel="Cerrar">
                <Text style={styles.closeButtonText}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            <AssistantChat items={items} setItems={setItems} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    height: 52,
    paddingHorizontal: 20,
    borderRadius: 26,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: 'white', fontWeight: '800', fontSize: 15 },
  fabBadge: {
    position: 'absolute',
    top: -6,
    right: -4,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  fabBadgeText: { color: 'white', fontWeight: '800', fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'flex-end' },
  backdropTouch: { flex: 1 },
  // Ventana: ocupa casi toda la pantalla, con las esquinas de arriba redondeadas.
  sheet: { height: '88%', backgroundColor: '#f8fafc', borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  headerSubtitle: { fontSize: 12, color: '#64748b' },
  headerAction: { paddingVertical: 6, paddingHorizontal: 4 },
  headerActionText: { color: '#047857', fontWeight: '700', fontSize: 13 },
  closeButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#f1f5f9' },
  closeButtonText: { color: '#0f172a', fontWeight: '700', fontSize: 14 },
});
