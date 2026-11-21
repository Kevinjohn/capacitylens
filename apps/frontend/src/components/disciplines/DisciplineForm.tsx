import { useFormLifetimeClose } from '@/hooks/useFormLifetimeClose';
import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { useEditSubmit } from '@/hooks/useEditSubmit';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { useFieldError } from '@/hooks/useFieldError';
import { validatePresetColor, parseName } from '@/lib/validation';
import { m } from '@/i18n';
import {
  ColorField,
  FormButtons,
  FormDialog,
  RequiredLegend,
  TextField,
} from '@/components/common/ui';
import { FieldError } from '@/components/ui/field';
import { DEFAULT_COLORS } from '@/lib/palette';
import type { Discipline } from '@capacitylens/shared/types/entities';

/** Creates or edits a discipline with its name and colour, closing after save or cancel. The server places a new discipline after the existing ones. */
export function DisciplineForm({
  discipline,
  onClose: close,
}: {
  discipline?: Discipline;
  onClose: () => void;
}) {
  const onClose = useFormLifetimeClose(close);
  const add = useStore((state) => state.addDiscipline);
  const update = useStore((state) => state.updateDiscipline);
  const [name, setName] = useState(discipline?.name ?? '');
  const [color, setColor] = useState(discipline?.color ?? DEFAULT_COLORS.discipline);
  const { error, errorField, errorId, fail } = useFieldError();
  const allDisciplines = useStore((state) => state.data.disciplines);
  const { pending, submit } = useEditSubmit({
    editing: discipline,
    rows: allDisciplines,
    staleMessage: m.form_discipline_err_changed,
    cancelledMessage: resolveErrorMessage,
    fail,
    onSaved: onClose,
  });

  const prepareSave = () => {
    const trimmed = parseName(name, fail);
    if (!trimmed) return null;
    if (!validatePresetColor(color, fail)) return null;
    const patch = { name: trimmed, color };
    return discipline ? () => update(discipline.id, patch, discipline.updatedAt) : () => add(patch);
  };

  return (
    <FormDialog
      title={discipline ? m.form_discipline_edit_title() : m.form_discipline_add_title()}
      onClose={onClose}
      onSubmit={() => {
        void submit(prepareSave);
      }}
      footer={<FormButtons onCancel={onClose} disabled={pending} />}
    >
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
        <TextField
          label={m.form_discipline_name_label()}
          value={name}
          onChange={setName}
          autoFocus
          required
          invalid={errorField === 'name'}
          describedById={errorId}
          layout="label-control"
        />
        <ColorField
          label={m.form_discipline_colour_label()}
          value={color}
          onChange={setColor}
          invalid={errorField === 'color'}
          describedById={errorId}
          layout="label-control"
          disabled={pending}
        />
      </fieldset>
      <FieldError id={errorId}>{error}</FieldError>
      <RequiredLegend />
    </FormDialog>
  );
}
