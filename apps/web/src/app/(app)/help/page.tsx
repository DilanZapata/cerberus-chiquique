'use client';

import { ReactNode } from 'react';
import {
  ScanFace,
  KeyRound,
  Smartphone,
  LayoutDashboard,
  Clock3,
  FileText,
  CalendarCheck2,
  Users,
  CalendarClock,
  Milk,
  Calculator,
  FileSpreadsheet,
  SlidersHorizontal,
  ShieldCheck,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

const TOC = [
  { id: 'marcaje', label: 'Como marcar entrada y salida' },
  { id: 'rostro', label: 'Enrolar tu rostro' },
  { id: 'dashboard', label: 'Dashboard y novedades' },
  { id: 'horas-extra', label: 'Horas extra' },
  { id: 'permisos', label: 'Permisos e incapacidades' },
  { id: 'descanso', label: 'Descanso compensatorio' },
  { id: 'empleados', label: 'Gestion de empleados' },
  { id: 'rutinas', label: 'Rutinas de turnos' },
  { id: 'ordeno', label: 'Rutina de ordeño' },
  { id: 'manual', label: 'Calculo manual de nomina' },
  { id: 'reportes', label: 'Reportes en Excel' },
  { id: 'configuracion', label: 'Configuracion' },
  { id: 'roles', label: 'Roles y permisos' },
  { id: 'movil', label: 'App movil' },
];

function Section({ id, icon, title, children }: { id: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="scroll-mt-24 p-6" id={id}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{icon}</div>
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
      </div>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-secondary">{children}</div>
    </Card>
  );
}

function NoveltyRow({ code, name, meaning }: { code: string; name: string; meaning: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-page p-3 sm:flex-row sm:items-baseline sm:gap-3">
      <Badge tone="info">{code}</Badge>
      <div>
        <span className="font-medium text-ink">{name}</span>
        <span className="text-ink-secondary"> — {meaning}</span>
      </div>
    </div>
  );
}

export default function HelpPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Guia de uso"
        subtitle="Como usar Cerberus dia a dia: marcaje, aprobaciones, nomina y administracion. Sin tecnicismos."
      />

      <Card className="p-5">
        <div className="text-sm font-semibold text-ink">Indice</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {TOC.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="rounded-full border border-line-axis px-3 py-1.5 text-xs font-medium text-ink-secondary hover:bg-surface-page"
            >
              {item.label}
            </a>
          ))}
        </div>
      </Card>

      <Section id="marcaje" icon={<KeyRound size={18} />} title="Como marcar entrada y salida">
        <p>Cada empleado marca su asistencia 4 veces al dia (o las que le correspondan): entrada, salida a almuerzo, reingreso de almuerzo, y salida final. Hay tres formas de hacerlo:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Kiosco por PIN</strong> (celular o tablet fijo en la entrada): el empleado escribe su codigo y su PIN de 4-6 digitos.</li>
          <li><strong>Kiosco por reconocimiento facial</strong> (pagina <code>/kiosk-facial</code>): el empleado se para frente a la camara y el sistema lo reconoce automaticamente — necesita tener el rostro enrolado antes (ver siguiente seccion).</li>
          <li><strong>App movil, modo Empleado</strong>: el empleado inicia sesion con su correo y contrasena, y marca desde su propio celular. El sistema valida que este dentro del radio permitido de su sede (GPS) y guarda una foto de respaldo.</li>
        </ul>
        <p>El sistema siempre detecta solo cual de las 4 marcas corresponde — nunca hay que indicarlo manualmente. Si alguien no marca el almuerzo (por ejemplo porque tiene permiso de jornada continua), el sistema lo entiende y no genera novedades raras.</p>
      </Section>

      <Section id="rostro" icon={<ScanFace size={18} />} title="Enrolar tu rostro">
        <p>Para poder marcar por reconocimiento facial, primero hay que "enrolar" el rostro del empleado una sola vez (desde <strong>Empleados → Enrolar rostro</strong>, en la web o en la app movil si tienes rol de administracion).</p>
        <p>Es obligatorio aceptar un consentimiento explicito antes de tomar la foto (la ley colombiana trata los datos biometricos como datos sensibles — Ley 1581 de 2012). El procesamiento ocurre siempre en los servidores propios de la empresa, nunca se envia a servicios externos, y el empleado puede pedir que se elimine su registro en cualquier momento (boton "Revocar rostro").</p>
      </Section>

      <Section id="dashboard" icon={<LayoutDashboard size={18} />} title="Dashboard y novedades">
        <p>El Dashboard muestra, para el dia que elijas, quien marco y que "novedades" genero cada quien. Una novedad es cualquier situacion que se sale de lo ordinario: llegar tarde, trabajar horas extra, trabajar un festivo, etc. Estas son las mas comunes:</p>
        <div className="space-y-2">
          <NoveltyRow code="RNO" name="Recargo Nocturno Ordinario" meaning="horas normales trabajadas de noche (desde las 7:00pm)." />
          <NoveltyRow code="DDCOF / DNCOF" name="Dominical/Festivo" meaning="trabajo en domingo o festivo, diurno o nocturno." />
          <NoveltyRow code="HEOD / HEON" name="Hora Extra Ordinaria" meaning="horas extra en dia normal, diurnas o nocturnas." />
          <NoveltyRow code="HEFD / HEFN" name="Hora Extra Festiva" meaning="horas extra en domingo/festivo, diurnas o nocturnas." />
          <NoveltyRow code="LLEGADA_TARDE" name="Llegada tarde" meaning="entro despues de su horario esperado." />
          <NoveltyRow code="SALIDA_ANTICIPADA" name="Salida anticipada" meaning="se fue antes de su horario esperado." />
        </div>
      </Section>

      <Section id="horas-extra" icon={<Clock3 size={18} />} title="Horas extra">
        <p>Cuando alguien trabaja mas de su jornada sin autorizacion previa, esas horas quedan <Badge tone="warning">Pendientes</Badge> en <strong>Horas Extra</strong>, esperando que un supervisor, RRHH o administrador las apruebe o rechace. Solo las horas <Badge tone="good">Aprobadas</Badge> cuentan para el pago.</p>
        <p>El sistema tambien avisa (sin bloquear nada) si alguien supero el tope legal de 2 horas extra al dia o 12 a la semana.</p>
      </Section>

      <Section id="permisos" icon={<FileText size={18} />} title="Permisos e incapacidades">
        <p>Desde <strong>Permisos e Incapacidades</strong> se registran ausencias justificadas: permiso remunerado, no remunerado, salida temporal, incapacidad general o de ARL, vacaciones. Igual que las horas extra, quedan pendientes hasta que alguien las apruebe. Al aprobar una, el sistema deja de calcular esa jornada a partir de las marcas y en su lugar registra directamente la novedad correspondiente.</p>
      </Section>

      <Section id="descanso" icon={<CalendarCheck2 size={18} />} title="Descanso compensatorio">
        <p>Cuando un empleado trabaja domingos o festivos mas de 2 veces en el mismo mes, la ley (Art. 180 CST) considera que se volvio "habitual" y le da derecho a un dia de descanso compensatorio. El sistema detecta esto automaticamente y lo deja listado en <strong>Descanso Compensatorio</strong>, donde se puede marcar como tomado cuando el empleado lo disfrute.</p>
      </Section>

      <Section id="empleados" icon={<Users size={18} />} title="Gestion de empleados">
        <p>En <strong>Empleados</strong> ves tu empresa, departamentos, sedes, y la lista completa del personal. Desde ahi puedes crear un empleado nuevo, editarlo, desactivarlo, y enrolar/revocar su rostro. Si tu empresa tiene mas de una sede, el sistema te pide elegir a cual pertenece cada empleado (si solo tienes una, se asigna sola).</p>
        <p>La contrasena (para el panel web) y el PIN (para el kiosco) son opcionales al crear un empleado, y al editar puedes dejarlos en blanco si no quieres cambiarlos.</p>
      </Section>

      <Section id="rutinas" icon={<CalendarClock size={18} />} title="Rutinas de turnos">
        <p>Para equipos con turnos rotativos (ej. dos personas cubriendo 24 horas), el generador inteligente arma la rotacion solo: le dices cuantas personas hay y que horario cubrir, y el sistema calcula los turnos y reparte los descansos de forma equitativa.</p>
      </Section>

      <Section id="ordeno" icon={<Milk size={18} />} title="Rutina de ordeño">
        <p>Modulo especializado para fincas: arma la rotacion de ordeñadores (jornada especial con dia corto quincenal) y el rol de vaquero, respetando que siempre haya 2 ordeñadores + 1 vaquero por cada ordeño. Puedes fijar 2 vaqueros permanentes con reemplazo automatico los dias que descansan, y si el equipo no alcanza, el sistema te dice exactamente cuantas personas mas hacen falta (o si renunciando al dia corto de algunos ya alcanza).</p>
      </Section>

      <Section id="manual" icon={<Calculator size={18} />} title="Calculo manual de nomina">
        <p>Si tienes registros en papel o en otro sistema, en <strong>Calculo Manual de Nomina</strong> eliges un empleado y un rango de fechas, y vas llenando la hora de entrada/salida de cada dia — el sistema calcula las novedades al instante, con el mismo motor que usa el marcaje automatico (incluyendo turnos nocturnos que cruzan la medianoche).</p>
      </Section>

      <Section id="reportes" icon={<FileSpreadsheet size={18} />} title="Reportes en Excel">
        <p>En <strong>Reportes</strong> eliges un rango de fechas y descargas un Excel con el resumen de horas por empleado y tipo de novedad, listo para llevar a nomina.</p>
      </Section>

      <Section id="configuracion" icon={<SlidersHorizontal size={18} />} title="Configuracion">
        <p><strong>Parametros de Nomina</strong> guarda los porcentajes de recargo (nocturno, dominical, extra) con vigencia por fecha, porque la ley colombiana los ha ido cambiando progresivamente. <strong>Configuracion SMTP</strong> define el correo desde el que se envian las alertas semanales de novedades pendientes.</p>
      </Section>

      <Section id="roles" icon={<ShieldCheck size={18} />} title="Roles y permisos">
        <p>Cada persona tiene un rol que determina que puede ver y hacer:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Empleado</strong>: solo puede marcar su propia asistencia (kiosco o app movil).</li>
          <li><strong>Supervisor</strong>: ademas puede aprobar horas extra y permisos de su equipo.</li>
          <li><strong>RRHH</strong>: acceso a gestion de empleados, nomina y reportes.</li>
          <li><strong>Administrador</strong>: acceso completo, incluyendo configuracion de la empresa.</li>
        </ul>
        <p>Estos mismos permisos aplican tanto en la web como en la app movil.</p>
      </Section>

      <Section id="movil" icon={<Smartphone size={18} />} title="App movil">
        <p>La app tiene dos entradas: <strong>Modo Kiosco</strong> (terminal compartida, sin login personal — para marcar por PIN o rostro) e <strong>Iniciar sesion</strong> (login personal). Si inicias sesion como empleado, ves la pantalla de marcaje por GPS; si inicias sesion como administrador, RRHH o supervisor, ves un panel con dashboard y gestion de empleados (crear, editar, enrolar rostro), igual que en la web pero adaptado a pantalla movil.</p>
      </Section>
    </div>
  );
}
