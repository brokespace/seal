import { describe, expect, it } from 'vitest'
import { dockerLayerStep } from './machine-docker-image-layers'

describe('dockerLayerStep', () => {
  it('unwraps the steps of a classic build', () => {
    expect(dockerLayerStep('/bin/sh -c #(nop)  CMD ["postgres"]')).toBe('CMD ["postgres"]')
    expect(dockerLayerStep('/bin/sh -c #(nop) ADD file:6f1a in / ')).toBe('ADD file:6f1a in /')
    expect(dockerLayerStep('/bin/sh -c apt-get update && apt-get install -y curl')).toBe(
      'RUN apt-get update && apt-get install -y curl'
    )
  })

  it('unwraps the steps of a BuildKit build', () => {
    expect(dockerLayerStep('RUN /bin/sh -c pip install torch # buildkit')).toBe(
      'RUN pip install torch'
    )
    expect(dockerLayerStep('COPY . /app # buildkit')).toBe('COPY . /app')
  })

  it('leaves a step that is already as written', () => {
    expect(dockerLayerStep('ENV PATH=/opt/conda/bin:/usr/bin')).toBe(
      'ENV PATH=/opt/conda/bin:/usr/bin'
    )
  })
})
