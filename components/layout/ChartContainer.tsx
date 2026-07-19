import type { PropsWithChildren } from 'react';
import styles from './ChartContainer.module.css';

const ChartContainer = ({ children }: PropsWithChildren) => {
  return (
    <div className={styles.chartContainer}>
      {children}
    </div>
  );
};

export default ChartContainer;
