'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Download, FileSpreadsheet, Upload } from 'lucide-react';
import {
  BulkImportOptions,
  BulkImportResult,
  Department,
  ImportFieldMode,
  WorkSite,
  bulkImportEmployees,
  downloadEmployeeImportTemplate,
  getDepartments,
  getWorkSites,
} from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

const inputClass =
  'mt-1 w-full rounded-lg border border-line-axis bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-sm font-medium text-ink-secondary';

const ROLE_LABELS: Record<string, string> = {
  EMPLOYEE: 'Empleado',
  SUPERVISOR: 'Supervisor',
  HR: 'Recursos Humanos',
  ADMIN: 'Administrador',
};

function ModeToggle({
  label,
  hint,
  mode,
  onModeChange,
  children,
}: {
  label: string;
  hint: string;
  mode: ImportFieldMode;
  onModeChange: (mode: ImportFieldMode) => void;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <p className="text-xs text-ink-muted">{hint}</p>
      <div className="mt-2 inline-flex rounded-lg border border-line-axis p-1">
        <button
          type="button"
          onClick={() => onModeChange('UNIFORM')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === 'UNIFORM' ? 'bg-ink text-white' : 'text-ink-secondary hover:bg-surface-page'
          }`}
        >
          Mismo para todos
        </button>
        <button
          type="button"
          onClick={() => onModeChange('PER_ROW')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === 'PER_ROW' ? 'bg-ink text-white' : 'text-ink-secondary hover:bg-surface-page'
          }`}
        >
          Cada uno en el Excel
        </button>
      </div>
      {mode === 'UNIFORM' && children && <div className="mt-2 max-w-xs">{children}</div>}
    </div>
  );
}

export default function BulkImportEmployeesPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [workSites, setWorkSites] = useState<WorkSite[]>([]);

  const [roleMode, setRoleMode] = useState<ImportFieldMode>('PER_ROW');
  const [roleValue, setRoleValue] = useState('EMPLOYEE');
  const [departmentMode, setDepartmentMode] = useState<ImportFieldMode>('PER_ROW');
  const [departmentValue, setDepartmentValue] = useState('');
  const [workSiteMode, setWorkSiteMode] = useState<ImportFieldMode>('PER_ROW');
  const [workSiteValue, setWorkSiteValue] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getDepartments(), getWorkSites()])
      .then(([d, w]) => {
        setDepartments(d);
        setWorkSites(w);
      })
      .catch(() => {});
  }, []);

  async function handleDownloadTemplate() {
    setDownloading(true);
    try {
      const blob = await downloadEmployeeImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'plantilla_empleados.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const options: BulkImportOptions = {
        roleMode,
        roleValue: roleMode === 'UNIFORM' ? roleValue : undefined,
        departmentMode,
        departmentValue: departmentMode === 'UNIFORM' ? departmentValue || undefined : undefined,
        workSiteMode,
        workSiteValue: workSiteMode === 'UNIFORM' ? workSiteValue || undefined : undefined,
      };
      const res = await bulkImportEmployees(file, options);
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Carga masiva de empleados"
        subtitle="Sube un Excel con varios empleados de una vez, en vez de crearlos uno por uno."
        actions={
          <Link href="/employees">
            <Button variant="secondary">
              <ArrowLeft size={16} /> Volver
            </Button>
          </Link>
        }
      />

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="mt-0.5 shrink-0 text-ink-muted" size={18} />
          <div>
            <div className="text-sm font-semibold text-ink">1. Descarga la plantilla</div>
            <p className="mt-0.5 text-xs text-ink-secondary">
              Ya trae los departamentos y sedes de tu empresa cargados como listas desplegables en Excel. Columnas
              con * son obligatorias por fila: código, cédula, nombre completo y fecha de ingreso (AAAA-MM-DD) — si
              falta la fecha, esa fila no se importa.
            </p>
          </div>
        </div>
        <Button className="mt-4" variant="secondary" onClick={handleDownloadTemplate} disabled={downloading}>
          <Download size={16} /> {downloading ? 'Descargando...' : 'Descargar plantilla'}
        </Button>
      </Card>

      <Card className="space-y-5 p-5">
        <div className="text-sm font-semibold text-ink">2. Configura cómo asignar rol, departamento y sede</div>

        <ModeToggle
          label="Rol"
          hint="Si dejas 'Cada uno en el Excel' vacío en una fila, esa fila queda como Empleado."
          mode={roleMode}
          onModeChange={setRoleMode}
        >
          <select className={inputClass} value={roleValue} onChange={(e) => setRoleValue(e.target.value)}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </ModeToggle>

        <ModeToggle
          label="Departamento"
          hint="Si dejas 'Cada uno en el Excel' vacío en una fila, esa fila queda sin asignar."
          mode={departmentMode}
          onModeChange={setDepartmentMode}
        >
          <select className={inputClass} value={departmentValue} onChange={(e) => setDepartmentValue(e.target.value)}>
            <option value="">Sin asignar</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </ModeToggle>

        <ModeToggle
          label="Sede"
          hint="Si dejas 'Cada uno en el Excel' vacío en una fila, esa fila queda sin asignar."
          mode={workSiteMode}
          onModeChange={setWorkSiteMode}
        >
          <select className={inputClass} value={workSiteValue} onChange={(e) => setWorkSiteValue(e.target.value)}>
            <option value="">Sin asignar</option>
            {workSites.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </ModeToggle>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="text-sm font-semibold text-ink">3. Sube el archivo lleno</div>
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-ink-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-surface-page file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink hover:file:bg-line-hair"
        />
        <Button onClick={handleImport} disabled={!file || importing}>
          <Upload size={16} /> {importing ? 'Importando...' : 'Importar'}
        </Button>
      </Card>

      {result && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="good">{result.created} creados</Badge>
            {result.errors.length > 0 && <Badge tone="warning">{result.errors.length} con error</Badge>}
          </div>

          {result.errors.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-line-hair text-sm">
                <thead className="bg-surface-page">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-ink-secondary">Fila</th>
                    <th className="px-3 py-2 text-left font-semibold text-ink-secondary">Código</th>
                    <th className="px-3 py-2 text-left font-semibold text-ink-secondary">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-hair">
                  {result.errors.map((e) => (
                    <tr key={e.row}>
                      <td className="px-3 py-2 text-ink-secondary">{e.row}</td>
                      <td className="px-3 py-2 text-ink-secondary">{e.employeeCode ?? '—'}</td>
                      <td className="px-3 py-2 text-ink-muted">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
