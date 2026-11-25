import { NormalisedAutomation, TimerLifeCycle, Trigger, TriggerDTO } from 'ontime-types';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import { addTrigger, editTrigger } from '../../../../common/api/automation';
import { maybeAxiosError } from '../../../../common/api/utils';
import Button from '../../../../common/components/buttons/Button';
import Input from '../../../../common/components/input/input/Input';
import Modal from '../../../../common/components/modal/Modal';
import Select from '../../../../common/components/select/Select';
import useCustomFields from '../../../../common/hooks-query/useCustomFields';
import * as Panel from '../../panel-utils/PanelUtils';
import { cycles } from './automationUtils';

import style from './TriggerForm.module.scss';

const formId = 'trigger-form';

interface TriggerFormProps {
  automations: NormalisedAutomation;
  trigger: Trigger | null;
  onCancel: () => void;
  postSubmit: () => void;
}

export default function TriggerForm({ automations, trigger, onCancel, postSubmit }: TriggerFormProps) {
  const { data: customFields } = useCustomFields();
  const {
    handleSubmit,
    register,
    setFocus,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting, isValid, isDirty },
  } = useForm<TriggerDTO>({
    defaultValues: {
      title: trigger?.title,
      trigger: trigger?.trigger ?? (cycles[0].value as TimerLifeCycle | undefined),
      automationId: trigger?.automationId ?? automations?.[Object.keys(automations)[0]]?.id,
      cueTrack: trigger?.cueTrack ?? '',
    },
    resetOptions: {
      keepDirtyValues: true,
    },
  });

  // give initial focus to the title field
  useEffect(() => {
    setFocus('title');
  }, [setFocus]);

  const onSubmit = async (values: TriggerDTO) => {
    if (trigger) {
      try {
        await editTrigger(trigger.id, { id: trigger.id, ...values });
        postSubmit();
      } catch (error) {
        setError('root', { message: `Failed to save changes to trigger ${maybeAxiosError(error)}` });
      }
      return;
    }

    // otherwise we are creating a new automation
    try {
      await addTrigger(values);
      postSubmit();
    } catch (error) {
      setError('root', { message: `Failed to save trigger ${maybeAxiosError(error)}` });
    }
  };

  const automationSelect = Object.keys(automations).map((automation) => {
    return {
      value: automation,
      label: automations[automation].title,
    };
  });

  const canSubmit = isDirty && isValid;

  // cue triggers can keep to the cues of one field, eg: only the QLab cues
  const isCueTrigger = watch('trigger') === TimerLifeCycle.onCueGo;
  const cueFieldSelect = [
    { value: '', label: 'Any cue' },
    ...Object.entries(customFields)
      .filter(([, field]) => field.type === 'cue' || field.type === 'text')
      .map(([key, field]) => ({ value: key, label: field.label })),
  ];

  return (
    <Modal
      isOpen
      onClose={onCancel}
      showBackdrop
      showCloseButton
      size='compact'
      title={trigger ? 'Edit trigger' : 'Create trigger'}
      bodyElements={
        <form id={formId} onSubmit={handleSubmit(onSubmit)} className={style.form}>
          <label className={style.titleField}>
            <Panel.Description>Title</Panel.Description>
            <Input
              {...register('title', { required: { value: true, message: 'Required field' } })}
              fluid
              defaultValue={trigger?.title}
              placeholder='Trigger title'
            />
            <Panel.Error>{errors.title?.message}</Panel.Error>
          </label>
          <div className={style.fields}>
            <label>
              <Panel.Description>When to run</Panel.Description>
              <Select
                value={watch('trigger')}
                onValueChange={(value) => {
                  if (value === null) return;
                  setValue('trigger', value as TimerLifeCycle, { shouldDirty: true });
                }}
                options={cycles.map((cycle) => ({ value: cycle.value, label: cycle.label }))}
                aria-label='Lifecycle trigger'
              />
              <Panel.Error>{errors.trigger?.message}</Panel.Error>
            </label>
            {isCueTrigger && (
              <label>
                <Panel.Description>Cues on</Panel.Description>
                <Select
                  value={watch('cueTrack') ?? ''}
                  onValueChange={(value: string | null) => {
                    setValue('cueTrack', value ?? '', { shouldDirty: true });
                  }}
                  options={cueFieldSelect}
                  aria-label='Cue field'
                />
              </label>
            )}
            <label>
              <Panel.Description>Automation</Panel.Description>
              <Select
                value={watch('automationId')}
                onValueChange={(value: string | null) => {
                  if (value === null) return;
                  setValue('automationId', value, { shouldDirty: true });
                }}
                options={automationSelect}
                aria-label='Automation title'
              />
              <Panel.Error>{errors.automationId?.message}</Panel.Error>
            </label>
          </div>
        </form>
      }
      footerElements={
        <>
          {errors.root && <Panel.Error>{errors.root.message}</Panel.Error>}
          <Button disabled={isSubmitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button type='submit' form={formId} variant='primary' disabled={!canSubmit} loading={isSubmitting}>
            Save
          </Button>
        </>
      }
    />
  );
}
