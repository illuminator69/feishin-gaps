import styles from './request-steps.module.css';

import { type RequestStep } from '/@/renderer/features/lbbot/request-steps';
import { Icon } from '/@/shared/components/icon/icon';

/** A request's steps, one row each (Navic's `RequestSteps`): done ticked, the moving one spinning. */
export const RequestSteps = ({ steps }: { steps: RequestStep[] }) => (
    <ol className={styles.steps} data-request-steps="">
        {steps.map((step) => (
            <li
                aria-current={step.status === 'now' ? 'step' : undefined}
                className={styles.step}
                data-status={step.status}
                key={step.label}
            >
                <span aria-hidden="true" className={styles.mark}>
                    {step.status === 'done' && <Icon icon="check" size="xs" />}
                </span>
                <span className={styles.label}>{step.label}</span>
                {step.detail && <span className={styles.detail}>{step.detail}</span>}
            </li>
        ))}
    </ol>
);
