import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { assistantChat, AssistantChatMessage, assistantConfirm, AssistantProposal } from '../services/api';
import { formatDateLong, hoursLabel } from '../utils/dates';

/** Cuantos mensajes del historial se le mandan al asistente (el servidor acepta hasta 40). */
const HISTORY_LIMIT = 30;

const SUGGESTIONS = [
  'Dame las horas extra pendientes',
  'Quiero autorizar horas extra',
  '¿Cuántas llegadas tarde tiene una persona este mes?',
];

type ProposalState = 'pending' | 'confirming' | 'confirmed' | 'cancelled' | 'failed';

export interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Autorizacion que el asistente dejo lista: no queda hecha hasta tocar Confirmar. */
  proposal?: AssistantProposal;
  proposalState?: ProposalState;
  proposalError?: string;
  /** true = aviso de la app (error de conexion, etc.): no se le manda al asistente como parte de la charla. */
  local?: boolean;
}

let nextId = 0;
const newId = () => `m${++nextId}`;

/**
 * El chat del asistente de Cerberus Managers: consulta horas extra y
 * novedades, y autoriza horas extra hablando. El asistente nunca autoriza
 * solo: deja la autorizacion lista en una tarjeta y queda hecha unicamente
 * cuando la persona toca "Confirmar".
 *
 * La conversacion (`items`) la guarda quien lo muestra (ver AssistantFab),
 * para que no se pierda al cerrar y volver a abrir la ventana.
 */
export default function AssistantChat({ items, setItems }: { items: ChatItem[]; setItems: Dispatch<SetStateAction<ChatItem[]>> }) {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatItem>>(null);

  useEffect(() => {
    // Siempre a la vista el ultimo mensaje.
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [items, sending]);

  const patch = (id: string, changes: Partial<ChatItem>) => setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  async function send(raw: string) {
    const content = raw.trim();
    if (!content || sending || !session) return;
    const userItem: ChatItem = { id: newId(), role: 'user', content };
    const nextItems = [...items, userItem];
    setItems(nextItems);
    setText('');
    setSending(true);
    try {
      const history: AssistantChatMessage[] = nextItems
        .filter((item) => !item.local)
        .slice(-HISTORY_LIMIT)
        .map((item) => ({ role: item.role, content: item.content }));
      const answer = await assistantChat(session.accessToken, history);
      setItems((prev) => [
        ...prev,
        {
          id: newId(),
          role: 'assistant',
          content: answer.reply,
          proposal: answer.pendingAction ?? undefined,
          proposalState: answer.pendingAction ? 'pending' : undefined,
        },
      ]);
    } catch (err) {
      setItems((prev) => [...prev, { id: newId(), role: 'assistant', content: (err as Error).message, local: true }]);
    } finally {
      setSending(false);
    }
  }

  async function confirm(item: ChatItem) {
    if (!session || !item.proposal || item.proposalState === 'confirming') return;
    patch(item.id, { proposalState: 'confirming', proposalError: undefined });
    try {
      const done = await assistantConfirm(session.accessToken, item.proposal.token);
      patch(item.id, { proposalState: 'confirmed' });
      // Queda en la charla, para que el asistente sepa que ya se hizo.
      setItems((prev) => [...prev, { id: newId(), role: 'assistant', content: done.message }]);
    } catch (err) {
      patch(item.id, { proposalState: 'failed', proposalError: (err as Error).message });
    }
  }

  function cancel(item: ChatItem) {
    patch(item.id, { proposalState: 'cancelled' });
    setItems((prev) => [...prev, { id: newId(), role: 'assistant', content: 'Autorización cancelada. No se guardó nada.' }]);
  }

  function renderItem({ item }: { item: ChatItem }) {
    const mine = item.role === 'user';
    return (
      <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : item.local ? styles.bubbleNotice : styles.bubbleTheirs]}>
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine, item.local && styles.bubbleTextNotice]}>{item.content}</Text>
        </View>
        {item.proposal && <ProposalCard item={item} onConfirm={() => confirm(item)} onCancel={() => cancel(item)} />}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>¿En qué te ayudo?</Text>
            <Text style={styles.emptyText}>
              Puedo consultar horas extra y novedades de una persona, y dejar lista una autorización de horas extra. Para
              autorizar te voy a pedir, por cada día, cuántas horas y el motivo.
            </Text>
            {SUGGESTIONS.map((suggestion) => (
              <TouchableOpacity key={suggestion} style={styles.suggestion} onPress={() => send(suggestion)}>
                <Text style={styles.suggestionText}>{suggestion}</Text>
              </TouchableOpacity>
            ))}
          </View>
        }
        ListFooterComponent={
          sending ? (
            <View style={[styles.row, styles.rowTheirs]}>
              <View style={[styles.bubble, styles.bubbleTheirs, styles.typing]}>
                <ActivityIndicator size="small" color="#475569" />
                <Text style={styles.typingText}>Consultando…</Text>
              </View>
            </View>
          ) : null
        }
      />
      <View style={[styles.inputBar, { paddingBottom: 10 + insets.bottom }]}>
        <TextInput
          style={styles.input}
          placeholder="Escribe aquí…"
          placeholderTextColor="#94a3b8"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={1500}
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendButton, (sending || !text.trim()) && styles.sendButtonDisabled]}
          onPress={() => send(text)}
          disabled={sending || !text.trim()}
          accessibilityLabel="Enviar mensaje"
        >
          <Text style={styles.sendButtonText}>Enviar</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Resumen de la autorizacion propuesta, con los botones para confirmarla o cancelarla. */
function ProposalCard({ item, onConfirm, onCancel }: { item: ChatItem; onConfirm: () => void; onCancel: () => void }) {
  const proposal = item.proposal!;
  const state = item.proposalState ?? 'pending';
  const open = state === 'pending' || state === 'confirming' || state === 'failed';
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Autorización de horas extra</Text>
      <Text style={styles.cardEmployee}>{proposal.employee.fullName}</Text>
      {proposal.days.map((day) => (
        <View key={day.date} style={styles.cardDay}>
          <Text style={styles.cardDayDate}>{formatDateLong(day.date)}</Text>
          <Text style={styles.cardDayHours}>
            {day.mode === 'PENDIENTES'
              ? `Autorizar ${hoursLabel(day.hours)} de las ${day.pendingHours} pendientes`
              : `Autorizar ${hoursLabel(day.hours)}`}
          </Text>
          <Text style={styles.cardDayDetail}>
            Queda con {hoursLabel(day.resultingAuthorizedHours)} autorizadas
            {day.currentAuthorizedHours > 0 ? ` (hoy tiene ${day.currentAuthorizedHours})` : ''}.
          </Text>
          <Text style={styles.cardDayReason}>Motivo: {day.reason}</Text>
        </View>
      ))}
      {state === 'confirmed' && <Text style={styles.cardDone}>Confirmada. Ya quedó autorizado.</Text>}
      {state === 'cancelled' && <Text style={styles.cardCancelled}>Cancelada. No se guardó nada.</Text>}
      {state === 'failed' && <Text style={styles.cardError}>{item.proposalError}</Text>}
      {open && (
        <View style={styles.cardActions}>
          <TouchableOpacity style={[styles.cardButton, styles.cardConfirm]} onPress={onConfirm} disabled={state === 'confirming'}>
            {state === 'confirming' ? <ActivityIndicator color="white" /> : <Text style={styles.cardConfirmText}>Confirmar</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.cardButton, styles.cardCancel]} onPress={onCancel} disabled={state === 'confirming'}>
            <Text style={styles.cardCancelText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Colores fijos (fondo claro, texto oscuro): con el telefono en modo oscuro el texto no puede quedar invisible.
  container: { flex: 1, backgroundColor: '#f8fafc' },
  list: { padding: 12, paddingBottom: 16, flexGrow: 1 },
  row: { marginBottom: 10, maxWidth: '88%' },
  rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: 14, paddingVertical: 9, paddingHorizontal: 12 },
  bubbleMine: { backgroundColor: '#0f172a', borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: 'white', borderWidth: 1, borderColor: '#e2e8f0', borderBottomLeftRadius: 4 },
  bubbleNotice: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  bubbleText: { fontSize: 15, lineHeight: 21, color: '#0f172a' },
  bubbleTextMine: { color: 'white' },
  bubbleTextNotice: { color: '#991b1b' },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typingText: { color: '#475569', fontSize: 14 },
  empty: { flex: 1, justifyContent: 'center', padding: 12, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  emptyText: { fontSize: 14, lineHeight: 20, color: '#475569', marginBottom: 6 },
  suggestion: { borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: 'white', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  suggestionText: { color: '#0f172a', fontSize: 14 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e2e8f0', backgroundColor: 'white' },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#0f172a', backgroundColor: 'white' },
  sendButton: { height: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#059669', alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { opacity: 0.45 },
  sendButtonText: { color: 'white', fontWeight: '700', fontSize: 15 },
  card: { marginTop: 8, width: 300, maxWidth: '100%', backgroundColor: 'white', borderWidth: 1, borderColor: '#059669', borderRadius: 12, padding: 12 },
  cardTitle: { fontSize: 12, fontWeight: '700', color: '#047857', textTransform: 'uppercase', letterSpacing: 0.4 },
  cardEmployee: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginTop: 2, marginBottom: 6 },
  cardDay: { borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingVertical: 8 },
  cardDayDate: { fontSize: 13, fontWeight: '700', color: '#0f172a', textTransform: 'capitalize' },
  cardDayHours: { fontSize: 14, color: '#0f172a', marginTop: 2 },
  cardDayDetail: { fontSize: 12, color: '#475569', marginTop: 1 },
  cardDayReason: { fontSize: 13, color: '#334155', marginTop: 3, fontStyle: 'italic' },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  cardButton: { flex: 1, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardConfirm: { backgroundColor: '#059669' },
  cardConfirmText: { color: 'white', fontWeight: '700', fontSize: 15 },
  cardCancel: { borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: 'white' },
  cardCancelText: { color: '#334155', fontWeight: '700', fontSize: 15 },
  cardDone: { marginTop: 8, color: '#047857', fontWeight: '700', fontSize: 13 },
  cardCancelled: { marginTop: 8, color: '#64748b', fontWeight: '600', fontSize: 13 },
  cardError: { marginTop: 8, color: '#b91c1c', fontSize: 13 },
});
