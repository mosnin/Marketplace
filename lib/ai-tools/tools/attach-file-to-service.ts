/**
 * `attach_file_to_service` — promote an uploaded image to a service's
 * photo gallery.
 *
 * Mutating but low-risk: writes to Service.photos[] (push, no replace)
 * and copies the storage object to the public service-photos/ prefix so
 * it can be embedded in `<img>` tags on public intake pages, MMS, etc.
 * Original private File row stays where it is — the provider can use the
 * same source file across multiple services without re-uploading.
 *
 * Approval: NOT required. The provider uploaded the file deliberately; the
 * attach is the obvious next step.
 */

import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { defineTool } from '../types';
import { copyObject, getPublicUrl, buildKey } from '@/lib/storage';

const parameters = z
  .object({
    fileId: z.string().min(1).describe('The File.id of the image to attach.'),
    serviceId: z.string().min(1).describe('The Service.id to attach it to.'),
  })
  .describe('Add an uploaded image to a service\'s photo gallery.');

interface AttachResult {
  serviceId: string;
  photoUrl: string;
  totalPhotos: number;
}

export const attachFileToServiceTool = defineTool<typeof parameters, AttachResult>({
  name: 'attach_file_to_service',
  riskLevel: 'safe',
  description:
    'Attach an uploaded image to a service\'s photo gallery. Use the file id from list_files. The image becomes embeddable on intake pages, listings, MMS, and emails.',
  parameters,
  requiresApproval: false,
  summariseCall(args) {
    return `Attach file ${args.fileId.slice(0, 8)} to service ${args.serviceId.slice(0, 8)}`;
  },

  async handler(args, ctx) {
    // Both rows must belong to this space — defensive against id-guessing.
    const [fileRes, propRes] = await Promise.all([
      supabase
        .from('File')
        .select('id, name, mimeType, category, storageKey')
        .eq('id', args.fileId)
        .eq('spaceId', ctx.space.id)
        .maybeSingle(),
      supabase
        .from('Service')
        .select('id, address, photos')
        .eq('id', args.serviceId)
        .eq('spaceId', ctx.space.id)
        .maybeSingle(),
    ]);

    if (fileRes.error) {
      return { summary: `File lookup failed: ${fileRes.error.message}`, display: 'error' };
    }
    if (!fileRes.data) {
      return { summary: `No file with id "${args.fileId}".`, display: 'error' };
    }
    const file = fileRes.data as {
      id: string;
      name: string;
      mimeType: string;
      category: string;
      storageKey: string;
    };

    if (file.category !== 'image') {
      return {
        summary: `Only image files can be attached as service photos. "${file.name}" is a ${file.category}.`,
        display: 'error',
      };
    }

    if (propRes.error) {
      return { summary: `Service lookup failed: ${propRes.error.message}`, display: 'error' };
    }
    if (!propRes.data) {
      return { summary: `No service with id "${args.serviceId}".`, display: 'error' };
    }
    const service = propRes.data as {
      id: string;
      address: string;
      photos: string[] | null;
    };

    // Copy to the public service-photos/ prefix. The original private
    // file in files/ stays put so the provider can re-use it.
    const destKey = buildKey(
      'servicePhotos',
      ctx.space.id,
      args.serviceId,
      // Filename portion of the original key.
      file.storageKey.split('/').pop() ?? `${args.fileId}-${file.name}`,
    );

    try {
      await copyObject({
        sourceKey: file.storageKey,
        destinationKey: destKey,
        contentType: file.mimeType,
        isPublic: true,
      });
    } catch (err) {
      return {
        summary: `Storage copy failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        display: 'error',
      };
    }

    const photoUrl = getPublicUrl(destKey);
    const nextPhotos = [...(service.photos ?? []), photoUrl];

    const { error: updateErr } = await supabase
      .from('Service')
      .update({ photos: nextPhotos })
      .eq('id', args.serviceId)
      .eq('spaceId', ctx.space.id);

    if (updateErr) {
      return {
        summary: `Service update failed: ${updateErr.message}`,
        display: 'error',
      };
    }

    return {
      summary: `Added "${file.name}" to ${service.address} (${nextPhotos.length} photo${nextPhotos.length === 1 ? '' : 's'}).`,
      data: {
        serviceId: args.serviceId,
        photoUrl,
        totalPhotos: nextPhotos.length,
      },
      display: 'success',
    };
  },
});
