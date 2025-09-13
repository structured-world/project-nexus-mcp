import {
  IProviderAdapter,
  MigrationPipeline,
  TransformOptions,
  LoadOptions,
  TransformResult,
  VerificationReport,
} from './IProviderAdapter.js';
import {
  WorkItem,
  WorkItemExport,
  WorkItemImport,
  WorkItemFilter,
  MigrationResult,
  Provider,
  WorkItemType,
  User,
} from '../types/index.js';
import { TypeMapper, MappingInput } from './TypeMapper.js';

/**
 * Default migration pipeline implementation
 * Handles ETL (Extract, Transform, Load) operations for work item migration
 */
export class DefaultMigrationPipeline implements MigrationPipeline {
  /**
   * Phase 1: Extract work items from source provider
   */
  async extract(source: IProviderAdapter, filter: WorkItemFilter): Promise<WorkItemExport[]> {
    console.log(`[Migration] Starting extraction from ${source.constructor.name}`);

    try {
      // Get work items matching filter
      const workItems = await source.listWorkItems(filter);
      console.log(`[Migration] Found ${workItems.length} work items to extract`);

      // Get detailed exports including relationships
      const workItemIds = workItems.map((wi) => wi.id);
      const exports = await source.exportWorkItems(workItemIds);

      console.log(`[Migration] Successfully exported ${exports.length} work items`);
      return exports;
    } catch (error) {
      console.error(`[Migration] Extraction failed:`, error);
      throw new Error(
        `Extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Phase 2: Transform work items for target provider
   */
  async transform(
    items: WorkItemExport[],
    targetProvider: Provider,
    options: TransformOptions,
  ): Promise<TransformResult> {
    console.log(`[Migration] Starting transformation for ${targetProvider} provider`);

    const result: TransformResult = {
      items: [],
      warnings: [],
      errors: [],
      fieldsMapped: new Map(),
      fieldsLost: [],
    };

    for (const item of items) {
      try {
        const transformed = await this.transformWorkItem(item, targetProvider, options, result);
        result.items.push(transformed);
      } catch (error) {
        const errorMsg = `Failed to transform item ${item.id}: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMsg);
        console.error(`[Migration] ${errorMsg}`);
      }
    }

    console.log(
      `[Migration] Transformation complete: ${result.items.length} items, ${result.warnings.length} warnings, ${result.errors.length} errors`,
    );
    return result;
  }

  /**
   * Phase 3: Load work items into target provider
   */
  async load(
    target: IProviderAdapter,
    items: WorkItemImport[],
    options: LoadOptions,
  ): Promise<MigrationResult> {
    console.log(`[Migration] Starting load phase with ${items.length} items`);

    const result: MigrationResult = {
      successful: 0,
      failed: [],
      mapping: new Map(),
    };

    if (options.dryRun) {
      console.log(`[Migration] DRY RUN: Would create ${items.length} work items`);
      // Simulate successful creation for dry run
      items.forEach((item, index) => {
        result.mapping.set(item.title, `dry-run-${index + 1}`);
      });
      result.successful = items.length;
      return result;
    }

    const batches = this.createBatches(items, options.batchSize);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(
        `[Migration] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} items)`,
      );

      await this.loadBatch(target, batch, options, result);

      // Brief pause between batches to avoid rate limits
      if (batchIndex < batches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(
      `[Migration] Load complete: ${result.successful} successful, ${result.failed.length} failed`,
    );
    return result;
  }

  /**
   * Phase 4: Verify migration integrity
   */
  async verify(
    source: WorkItemExport[],
    target: WorkItem[],
    mapping: Map<string, string>,
  ): Promise<VerificationReport> {
    await Promise.resolve();
    console.log('[Migration] Starting verification');

    const report: VerificationReport = {
      totalItems: source.length,
      successful: target.length,
      failed: source.length - target.length,
      dataIntegrityIssues: [],
    };

    // Verify each migrated item
    for (const sourceItem of source) {
      const targetId = mapping.get(sourceItem.title) ?? mapping.get(sourceItem.id);
      if (!targetId) {
        continue; // Item wasn't migrated
      }

      const targetItem = target.find((t) => t.id.includes(targetId));
      if (!targetItem) {
        report.dataIntegrityIssues.push({
          originalId: sourceItem.id,
          newId: targetId,
          issue: 'Target item not found after migration',
        });
        continue;
      }

      // Check data integrity
      this.verifyDataIntegrity(sourceItem, targetItem, report);
    }

    console.log(
      `[Migration] Verification complete: ${report.dataIntegrityIssues.length} integrity issues found`,
    );
    return report;
  }

  // Private helper methods

  private async transformWorkItem(
    item: WorkItemExport,
    targetProvider: Provider,
    options: TransformOptions,
    result: TransformResult,
  ): Promise<WorkItemImport> {
    // Validate required fields
    if (!item.title) {
      throw new Error(`Failed to transform item ${item.id}: Missing or invalid title`);
    }
    // Map work item type using intelligent type mapper
    const mappingInput: MappingInput = {
      provider: item.provider, // Source provider
      process: targetProvider === 'azure' ? 'agile' : undefined, // Target Azure process
      title: item.title,
      description: item.description,
    };

    // Add provider-specific hints
    if (item.provider === 'gitlab') {
      mappingInput.gitlab = {
        glType: this.detectGitLabType(item),
        isGroupEpic: item.type === 'epic',
        childCount: item.relationships.children.length,
      };
    } else if (item.provider === 'github') {
      mappingInput.github = {
        labels: {
          has: (label: string) => item.labels.some((l) => l.toLowerCase() === label.toLowerCase()),
          all: item.labels,
        },
        childCount: item.relationships.children.length,
      };
    }

    const typeMapping = TypeMapper.mapType(mappingInput);

    // Transform users
    const transformedAssignees = await this.transformUsers(
      item.assignees,
      options.mapUsers,
      result,
    );

    // Transform labels
    const transformedLabels = this.transformLabels(item.labels, options.mapLabels, result);

    // Add type mapping tags if needed
    if (typeMapping.addTags.length > 0) {
      transformedLabels.push(...typeMapping.addTags);
      result.warnings.push(
        `Added type mapping tags for ${item.id}: ${typeMapping.addTags.join(', ')}`,
      );
    }

    // Handle custom fields
    const customFields = await this.transformCustomFields(
      item.providerFields,
      item.provider,
      options.customFieldMapping,
      result,
    );

    // Preserve original ID in description if requested
    let description = item.description;
    if (options.preserveIds) {
      description = `**Migrated from ${item.provider}:${item.id}**\n\n${description}`;
    }

    // Handle missing fields based on strategy
    this.handleMissingFields(
      item,
      targetProvider,
      options.handleMissingFields,
      result,
      customFields,
    );

    const transformedItem: WorkItemImport = {
      title: item.title,
      description,
      type: this.normalizeWorkItemType(typeMapping.targetType),
      state: item.state,
      labels: [...new Set(transformedLabels)], // Remove duplicates
      assignees: transformedAssignees,
      priority: item.priority,
      customFields,
    };

    // Log transformation rationale
    if (typeMapping.rationale.length > 0) {
      result.warnings.push(`Type mapping for ${item.id}: ${typeMapping.rationale.join('; ')}`);
    }

    return transformedItem;
  }

  private async loadBatch(
    target: IProviderAdapter,
    batch: WorkItemImport[],
    options: LoadOptions,
    result: MigrationResult,
  ): Promise<void> {
    for (const item of batch) {
      try {
        const created = await target.createWorkItem({
          type: item.type,
          title: item.title,
          description: item.description,
          assignees: item.assignees,
          labels: item.labels,
          priority: item.priority,
          customFields: item.customFields,
        });

        result.successful++;
        result.mapping.set(item.title, created.id);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.failed.push({
          id: item.title,
          reason: errorMsg,
        });

        if (!options.continueOnError) {
          throw new Error(`Batch load failed on item "${item.title}": ${errorMsg}`);
        }
      }
    }
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private async transformUsers(
    users: User[],
    userMapping: Map<string, string>,
    result: TransformResult,
  ): Promise<User[]> {
    await Promise.resolve();
    const transformedUsers: User[] = [];

    for (const user of users) {
      const mappedUsername = userMapping.get(user.username) ?? userMapping.get(user.email ?? '');

      if (mappedUsername) {
        transformedUsers.push({
          ...user,
          username: mappedUsername,
        });
        result.fieldsMapped.set(`user:${user.username}`, mappedUsername);
      } else {
        result.warnings.push(`No mapping found for user: ${user.username} (${user.displayName})`);
        // Keep original user - target system will need to handle unmapped users
        transformedUsers.push(user);
      }
    }

    return transformedUsers;
  }

  private transformLabels(
    labels: string[],
    labelMapping: Map<string, string>,
    result: TransformResult,
  ): string[] {
    const transformedLabels: string[] = [];

    for (const label of labels) {
      const mappedLabel = labelMapping.get(label);
      if (mappedLabel) {
        transformedLabels.push(mappedLabel);
        result.fieldsMapped.set(`label:${label}`, mappedLabel);
      } else {
        transformedLabels.push(label); // Keep original label
      }
    }

    return transformedLabels;
  }

  private async transformCustomFields(
    providerFields: unknown,
    sourceProvider: Provider,
    customFieldMapping: Record<string, string>,
    result: TransformResult,
  ): Promise<Record<string, unknown>> {
    await Promise.resolve();
    const customFields: Record<string, unknown> = {};

    // Extract meaningful fields from provider-specific data
    if (
      sourceProvider === 'gitlab' &&
      typeof providerFields === 'object' &&
      providerFields !== null
    ) {
      if ('weight' in providerFields && providerFields.weight) {
        const targetField = customFieldMapping['weight'] ?? 'weight';
        customFields[targetField] = providerFields.weight;
        result.fieldsMapped.set('weight', targetField);
      }

      if ('timeEstimate' in providerFields && providerFields.timeEstimate) {
        const targetField = customFieldMapping['timeEstimate'] ?? 'timeEstimate';
        customFields[targetField] = providerFields.timeEstimate;
        result.fieldsMapped.set('timeEstimate', targetField);
      }
    }

    if (
      sourceProvider === 'azure' &&
      typeof providerFields === 'object' &&
      providerFields !== null
    ) {
      if ('storyPoints' in providerFields && providerFields.storyPoints) {
        const targetField = customFieldMapping['storyPoints'] ?? 'storyPoints';
        customFields[targetField] = providerFields.storyPoints;
        result.fieldsMapped.set('storyPoints', targetField);
      }

      if ('effort' in providerFields && providerFields.effort) {
        const targetField = customFieldMapping['effort'] ?? 'effort';
        customFields[targetField] = providerFields.effort;
        result.fieldsMapped.set('effort', targetField);
      }
    }

    // Apply explicit custom field mappings
    for (const [sourceField, targetField] of Object.entries(customFieldMapping)) {
      if (
        typeof providerFields === 'object' &&
        providerFields !== null &&
        sourceField in providerFields
      ) {
        customFields[targetField] = (providerFields as Record<string, unknown>)[sourceField];
        result.fieldsMapped.set(sourceField, targetField);
      }
    }

    return customFields;
  }

  private handleMissingFields(
    item: WorkItemExport,
    targetProvider: Provider,
    strategy: 'ignore' | 'metadata' | 'description',
    result: TransformResult,
    customFields: Record<string, unknown>,
  ): void {
    const missingFields: string[] = [];

    // Check for provider-specific features that might be lost
    if (item.provider === 'gitlab' && targetProvider !== 'gitlab') {
      const fields = item.providerFields as unknown as Record<string, unknown>;
      if ('confidential' in fields && fields.confidential) {
        missingFields.push('confidential');
      }
      if ('weight' in fields && fields.weight && !customFields.weight) {
        missingFields.push('weight');
      }
    }

    if (item.provider === 'azure' && targetProvider !== 'azure') {
      const fields = item.providerFields as unknown as Record<string, unknown>;
      if ('areaPath' in fields && fields.areaPath) {
        missingFields.push('areaPath');
      }
      if ('iterationPath' in fields && fields.iterationPath) {
        missingFields.push('iterationPath');
      }
    }

    if (missingFields.length > 0) {
      result.fieldsLost.push(...missingFields);

      switch (strategy) {
        case 'ignore':
          // Do nothing
          break;
        case 'metadata':
          customFields['migrationMetadata'] = {
            lostFields: missingFields,
            sourceProvider: item.provider,
          };
          break;
        case 'description':
          // Fields are handled in description during transformation
          break;
      }

      result.warnings.push(`Lost fields for ${item.id}: ${missingFields.join(', ')}`);
    }
  }

  private detectGitLabType(
    item: WorkItemExport,
  ): 'epic' | 'issue' | 'task' | 'incident' | 'bug' | 'test_case' {
    if (item.type === 'epic') return 'epic';
    if (item.type === 'bug') return 'incident';
    if (item.type === 'task') return 'task';
    if (item.type === 'test') return 'test_case';
    if (item.type === 'story') return 'issue'; // GitLab treats stories as issues
    return 'issue';
  }

  private normalizeWorkItemType(typeString: string): WorkItemType {
    const typeMap: Record<string, WorkItemType> = {
      Epic: 'epic',
      Feature: 'feature',
      'User Story': 'story',
      'Product Backlog Item': 'story',
      Issue: 'issue',
      Task: 'task',
      Bug: 'bug',
      'Test Case': 'test',
      epic: 'epic',
      feature: 'feature',
      story: 'story',
      issue: 'issue',
      task: 'task',
      bug: 'bug',
      test: 'test',
    };

    return typeMap[typeString] ?? 'issue';
  }

  private verifyDataIntegrity(
    sourceItem: WorkItemExport,
    targetItem: WorkItem,
    report: VerificationReport,
  ): void {
    // Check title integrity
    if (sourceItem.title !== targetItem.title) {
      report.dataIntegrityIssues.push({
        originalId: sourceItem.id,
        newId: targetItem.id,
        issue: `Title mismatch: expected "${sourceItem.title}", got "${targetItem.title}"`,
      });
    }

    // Check state integrity
    if (sourceItem.state !== targetItem.state) {
      report.dataIntegrityIssues.push({
        originalId: sourceItem.id,
        newId: targetItem.id,
        issue: `State mismatch: expected "${sourceItem.state}", got "${targetItem.state}"`,
      });
    }

    // Check assignee count (allowing for platform limitations)
    const expectedAssigneeCount = Math.min(sourceItem.assignees.length, 10); // Platform limits
    if (targetItem.assignees.length !== expectedAssigneeCount) {
      report.dataIntegrityIssues.push({
        originalId: sourceItem.id,
        newId: targetItem.id,
        issue: `Assignee count mismatch: expected ${expectedAssigneeCount}, got ${targetItem.assignees.length}`,
      });
    }
  }
}

/**
 * Migration orchestrator for complex scenarios
 */
export class MigrationOrchestrator {
  constructor(private pipeline: MigrationPipeline = new DefaultMigrationPipeline()) {}

  /**
   * Execute full migration between providers
   */
  async migrate(
    source: IProviderAdapter,
    target: IProviderAdapter,
    filter: WorkItemFilter,
    options: {
      transform: TransformOptions;
      load: LoadOptions;
      skipVerification?: boolean;
    },
  ): Promise<{
    migration: MigrationResult;
    verification?: VerificationReport;
    transformResult: TransformResult;
  }> {
    console.log(`[Migration] Starting full migration`);

    // Phase 1: Extract
    const exported = await this.pipeline.extract(source, filter);

    // Phase 2: Transform
    const transformResult = await this.pipeline.transform(
      exported,
      this.detectTargetProvider(target),
      options.transform,
    );

    if (transformResult.errors.length > 0) {
      throw new Error(`Transformation failed: ${transformResult.errors.join('; ')}`);
    }

    // Phase 3: Load
    const migration = await this.pipeline.load(target, transformResult.items, options.load);

    let verification: VerificationReport | undefined;

    // Phase 4: Verify (optional)
    if (!options.skipVerification && !options.load.dryRun) {
      try {
        const targetItems = await target.listWorkItems({ state: 'all' });
        verification = await this.pipeline.verify(exported, targetItems, migration.mapping);
      } catch (error) {
        console.warn(
          `[Migration] Verification failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    console.log(`[Migration] Migration complete`);
    return { migration, verification, transformResult };
  }

  private detectTargetProvider(adapter: IProviderAdapter): Provider {
    const className = adapter.constructor.name;
    if (className.includes('GitLab')) return 'gitlab';
    if (className.includes('GitHub')) return 'github';
    if (className.includes('Azure')) return 'azure';
    throw new Error(`Cannot detect provider type from adapter: ${className}`);
  }
}
